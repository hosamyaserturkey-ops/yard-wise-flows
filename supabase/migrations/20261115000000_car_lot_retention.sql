-- Car-lot retention: 12 months after a car is released, its visit, inspections
-- and photo rows are deleted (the photo FILES in R2 are deleted by the Worker's
-- daily job, from the list this function hands it).
--
-- Safeguards, all enforced HERE so that no change to the Worker can weaken them:
--   * Nothing is deleted before `delete_not_before` (7 days after install): until
--     then every run only REPORTS what it would delete, into retention_log.
--   * At most 50 visits per run.
--   * A car with a visit ON HOLD is never touched (its older visits stay); the
--     12 months of a visit only count once the car has no hold.
--   * The period cannot be set below 12 months (check constraint).
--   * Files are queued in retention_pending_files in the SAME transaction as the
--     row deletes, and removed from the queue only when the Worker confirms it
--     deleted them, so a failed file delete is retried, never forgotten.
--   * Only a caller that knows the retention token can run it (the Worker holds
--     it as a secret; only its SHA-256 is stored here).
--   * Inspections and photos cannot be deleted by anyone (guard triggers); the
--     purge lifts those guards only inside its own transaction.

create table if not exists private.retention_settings (
  id                boolean primary key default true check (id),   -- one row
  token_hash        text not null,
  months            integer not null default 12 check (months >= 12),
  delete_not_before timestamptz not null default (now() + interval '7 days')
);
insert into private.retention_settings (token_hash)
values ('c2ff31e76d36f6be42e7ace8e8d38b948bef8337767016a506977c9e0e5384ba')
on conflict (id) do nothing;

-- What was (or would be) deleted. Kept after the deletion as the audit trail:
-- no photos, no personal data beyond the VIN and ticket number.
create table if not exists public.retention_log (
  id              bigint generated always as identity primary key,
  logged_at       timestamptz not null default now(),
  mode            text not null check (mode in ('report', 'delete')),
  visit_id        uuid not null,
  vehicle_id      uuid not null,
  manufacturer_id uuid not null,
  vin             text not null,
  ticket_number   integer not null,
  released_at     timestamptz not null,
  inspections     integer not null,
  photos          integer not null
);
create unique index if not exists retention_log_one_report_per_visit
  on public.retention_log (visit_id) where mode = 'report';
alter table public.retention_log enable row level security;
create policy retention_log_select on public.retention_log for select to authenticated
  using ((select private.is_super_admin((select auth.uid()))));

create table if not exists private.retention_pending_files (
  storage_path text primary key,
  queued_at    timestamptz not null default now()
);

create or replace function private.retention_check_token(_token text)
returns private.retention_settings language plpgsql stable security definer set search_path = private, public as $$
declare cfg private.retention_settings;
begin
  select * into cfg from private.retention_settings;
  if not found or _token is null
     or cfg.token_hash is distinct from encode(sha256(convert_to(_token, 'UTF8')), 'hex') then
    raise exception 'invalid retention token' using errcode = '42501';
  end if;
  return cfg;
end $$;

create or replace function public.car_lot_retention_run(_token text, _dry_run boolean default true)
returns jsonb language plpgsql security definer set search_path = private, public as $$
declare
  cfg private.retention_settings;
  cutoff timestamptz;
  report_only boolean;
  v record;
  n_insp integer; n_photos integer;
  ids uuid[] := '{}';
  candidates integer := 0;
  deleted integer := 0;
  files text[];
begin
  cfg := private.retention_check_token(_token);
  cutoff := now() - make_interval(months => cfg.months);
  -- Report only, unless the caller asked to delete AND the waiting period is over.
  report_only := _dry_run or now() < cfg.delete_not_before;

  for v in
    select vv.id, vv.vehicle_id, vv.manufacturer_id, vv.ticket_number, vv.gate_out_time, ve.vin
      from public.vehicle_visits vv
      join public.vehicles ve on ve.id = vv.vehicle_id
     where vv.status = 'out' and vv.gate_out_time < cutoff
       and not exists (select 1 from public.vehicle_visits h
                        where h.vehicle_id = vv.vehicle_id and h.status = 'on-hold')
     order by vv.gate_out_time
     limit 50
  loop
    candidates := candidates + 1;
    select count(*) into n_insp from public.vehicle_inspections where visit_id = v.id;
    select count(*) into n_photos from public.vehicle_inspection_photos p
      join public.vehicle_inspections i on i.id = p.inspection_id where i.visit_id = v.id;
    insert into public.retention_log (mode, visit_id, vehicle_id, manufacturer_id, vin, ticket_number, released_at, inspections, photos)
    values (case when report_only then 'report' else 'delete' end, v.id, v.vehicle_id, v.manufacturer_id, v.vin,
            v.ticket_number, v.gate_out_time, n_insp, n_photos)
    on conflict (visit_id) where mode = 'report' do nothing;
    ids := ids || v.id;
  end loop;

  if not report_only and cardinality(ids) > 0 then
    -- the guards that make evidence undeletable are lifted only inside this transaction
    alter table public.vehicle_inspection_photos disable trigger vehicle_inspection_photos_guard_trg;
    alter table public.vehicle_inspections disable trigger vehicle_inspections_guard_trg;
    insert into private.retention_pending_files (storage_path)
      select p.storage_path from public.vehicle_inspection_photos p
        join public.vehicle_inspections i on i.id = p.inspection_id where i.visit_id = any (ids)
      on conflict do nothing;
    delete from public.vehicle_inspection_photos p using public.vehicle_inspections i
      where i.id = p.inspection_id and i.visit_id = any (ids);
    delete from public.vehicle_inspections where visit_id = any (ids);
    delete from public.vehicle_visits where id = any (ids);
    get diagnostics deleted = row_count;
    alter table public.vehicle_inspection_photos enable trigger vehicle_inspection_photos_guard_trg;
    alter table public.vehicle_inspections enable trigger vehicle_inspections_guard_trg;
  end if;

  select coalesce(array_agg(storage_path order by queued_at), '{}') into files
    from (select storage_path, queued_at from private.retention_pending_files order by queued_at limit 500) f;

  return jsonb_build_object(
    'mode', case when report_only then 'report' else 'delete' end,
    'cutoff', cutoff, 'delete_not_before', cfg.delete_not_before,
    'candidates', candidates, 'deleted_visits', case when report_only then 0 else deleted end,
    'files', to_jsonb(files));
end $$;

-- The Worker calls this after it has deleted those files from R2.
create or replace function public.car_lot_retention_ack(_token text, _keys text[])
returns integer language plpgsql security definer set search_path = private, public as $$
declare n integer;
begin
  perform private.retention_check_token(_token);
  delete from private.retention_pending_files where storage_path = any (_keys);
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function private.retention_check_token(text) from public, anon, authenticated;
revoke all on function public.car_lot_retention_run(text, boolean), public.car_lot_retention_ack(text, text[]) from public, anon, authenticated;
-- Reachable with the public key, but useless without the token.
grant execute on function public.car_lot_retention_run(text, boolean), public.car_lot_retention_ack(text, text[]) to anon, authenticated, service_role;

-- The token hash and the file queue are for these functions only: closed to everyone else,
-- whatever the project's default privileges grant on new tables.
revoke all on private.retention_settings, private.retention_pending_files from public, anon, authenticated;
