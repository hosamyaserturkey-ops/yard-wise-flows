-- =====================================================================
-- CAR LOT - PART 2 of 2  (schema, RLS, storage)            REVISION 2
-- Project: Container Yard (qctvjwlaxnidprhcxodj)
-- STATUS: draft, NOT applied anywhere. Tested only on a local,
--         schema-only replica of production (docs/car-lot/phase0-review.md).
--         Test on a Supabase branch before production.
-- Run only AFTER part 1 has been committed.
--
-- Design in one paragraph (unchanged from revision 1)
--   * The car lot is a second row in public.yards (kind = 'vehicle').
--     Staff are separated from the container yard by yard_id.
--   * Manufacturers are sub-tenants INSIDE the car-lot yard. A manufacturer
--     user has role 'manufacturer_rep', profiles.yard_id = NULL and
--     profiles.manufacturer_id = <their manufacturer>.
--   * Photo files live in a new private Cloudflare R2 bucket
--     'vehicle-inspections' (decision B), keyed
--     {manufacturer_id}/{vehicle_id}/{inspection_id}/{random}.jpg, served only
--     through the Worker after Postgres says yes. Nobody can update or delete
--     a photo.
--
-- What changed from revision 1 (why: phase0-review.md)
--   A. The fence around the container side now covers every container
--      table, not only public.containers. Revision 1 let a car-lot inspector
--      APPROVE a container inspection, and a car-lot admin open a visit on a
--      real container (which blocks its real gate-in).
--   B. Vehicles and manufacturers can only live in a car-lot yard, so
--      container-yard admins/inspectors cannot create them in their yard.
--   C. A visit can't be moved to another vehicle/manufacturer, a vehicle with
--      history can't change manufacturer, an on-hold car can't be gated out,
--      and a released visit can't be reopened - enforced in Postgres.
--   D. Helpers live in schema "private" (not reachable over the REST API) and
--      PUBLIC/anon lose EXECUTE. Revision 1 let anyone, signed in or not, ask
--      is_manufacturer_rep(<any user>) and is_vehicle_side_user(<any user>).
--   E. Works before AND after the repo's pending migrations
--      20261011120000 / 20261011130000 (not yet on production): legacy
--      helpers are called without a schema under search_path private, public,
--      and the existing profiles policy is no longer dropped and re-created
--      (a trigger guards manufacturer_id instead).
--   F. Photo table renamed inspection_photos -> vehicle_inspection_photos so
--      it can't be confused with the container bucket 'inspection-photos'.
--   G. Policies evaluate the caller's role/yard once per query (InitPlan),
--      FK indexes added, trigger functions have a fixed search_path.
--   H. Photo files in Cloudflare R2, not Supabase Storage (decision B: the
--      Free plan's 1 GB holds ~100 cars). No Supabase bucket or storage
--      policies for vehicles; vehicle_photo_upload_prefix() replaces them.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Schema for helpers. Same statements as the pending lock-down
--    migration, so whichever runs second is a no-op here.
-- ---------------------------------------------------------------------
create schema if not exists private;
revoke all on schema private from public;
grant usage on schema private to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 1. Location kind + the car lot as a second yard
--    (metadata-only change on yards; the existing row gets 'container')
-- ---------------------------------------------------------------------
alter table public.yards
  add column if not exists kind text not null default 'container'
  check (kind in ('container', 'vehicle'));

-- created_by is NOT NULL, so borrow the first super_admin. With no
-- super_admin (e.g. a fresh Supabase branch) this inserts nothing - check
-- the yard exists afterwards.
insert into public.yards (name, code, kind, created_by)
select 'Everest Logistics - Car Lot', 'evl-cars', 'vehicle', ur.user_id
from public.user_roles ur
where ur.role = 'super_admin'
order by ur.user_id
limit 1
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 2. Manufacturers + the link from a user to a manufacturer
-- ---------------------------------------------------------------------
create table public.manufacturers (
  id                 uuid primary key default gen_random_uuid(),
  yard_id            uuid not null references public.yards(id),
  code               text not null,
  name               text not null,
  contact_email      text,
  default_free_days  integer not null default 7,
  default_daily_rate numeric,
  active             boolean not null default true,
  created_at         timestamptz not null default now(),
  unique (yard_id, code),
  unique (id, yard_id)          -- target of vehicles' (manufacturer_id, yard_id) FK
);
alter table public.manufacturers enable row level security;

alter table public.profiles
  add column if not exists manufacturer_id uuid references public.manufacturers(id);
create index if not exists profiles_manufacturer_id_idx on public.profiles (manufacturer_id);

-- A profile is either staff (yard_id) or a manufacturer user
-- (manufacturer_id), never both. Every existing profile passes (all NULL).
alter table public.profiles
  add constraint profiles_manufacturer_xor_yard
  check (manufacturer_id is null or yard_id is null);

-- ---------------------------------------------------------------------
-- 3. Helpers (schema private, SECURITY DEFINER, fixed search_path)
--
--    is_super_admin / current_yard_id / is_yard_admin / has_role are
--    called WITHOUT a schema on purpose: search_path private, public finds
--    them in public today and in private once the pending lock-down
--    migration moves them. That migration refuses to run while anything
--    calls them as public.<name>(...).
-- ---------------------------------------------------------------------
create or replace function private.yard_kind(_yard uuid)
returns text language sql stable security definer set search_path = private, public as $$
  select y.kind from public.yards y where y.id = _yard;
$$;

create or replace function private.is_manufacturer_rep(_uid uuid)
returns boolean language sql stable security definer set search_path = private, public as $$
  select exists (select 1 from public.user_roles ur
                  where ur.user_id = _uid and ur.role = 'manufacturer_rep');
$$;

-- The caller's manufacturer, only if they hold the manufacturer_rep role.
create or replace function private.current_manufacturer_id()
returns uuid language sql stable security definer set search_path = private, public as $$
  select p.manufacturer_id from public.profiles p
   where p.user_id = auth.uid() and private.is_manufacturer_rep(auth.uid())
   limit 1;
$$;

-- The caller's yard if it is a car lot and the caller is lot staff; else NULL.
create or replace function private.lot_staff_yard()
returns uuid language sql stable security definer set search_path = private, public as $$
  select p.yard_id from public.profiles p
    join public.yards y on y.id = p.yard_id
   where p.user_id = auth.uid() and y.kind = 'vehicle'
     and not private.is_manufacturer_rep(auth.uid())
   limit 1;
$$;

-- ... and only if they may write there: yard admin or inspector.
-- (Office role 'user' is read-only - open decision 1 in the plan.)
create or replace function private.lot_writer_yard()
returns uuid language sql stable security definer set search_path = private, public as $$
  select case when is_yard_admin(auth.uid(), private.lot_staff_yard())
                or has_role(auth.uid(), 'inspector')
              then private.lot_staff_yard() end;
$$;

-- ... and only if they administer it: yard admin.
create or replace function private.lot_admin_yard()
returns uuid language sql stable security definer set search_path = private, public as $$
  select case when is_yard_admin(auth.uid(), private.lot_staff_yard())
              then private.lot_staff_yard() end;
$$;

create or replace function private.lot_is_owner()
returns boolean language sql stable security definer set search_path = private, public as $$
  select coalesce(is_super_admin(auth.uid()), false);
$$;

-- "Car-lot side" = manufacturer users + staff whose yard is a car lot.
create or replace function private.is_vehicle_side_user(_uid uuid)
returns boolean language sql stable security definer set search_path = private, public as $$
  select private.is_manufacturer_rep(_uid)
      or exists (select 1 from public.profiles p
                  where p.user_id = _uid and p.manufacturer_id is not null)
      or exists (select 1 from public.profiles p
                   join public.yards y on y.id = p.yard_id
                  where p.user_id = _uid and y.kind = 'vehicle');
$$;

-- Used by the fences: false only for car-lot staff and manufacturer users.
create or replace function private.container_side_allowed()
returns boolean language sql stable security definer set search_path = private, public as $$
  select coalesce(is_super_admin(auth.uid()), false)
      or not private.is_vehicle_side_user(auth.uid());
$$;

-- ---------------------------------------------------------------------
-- 4. Trigger functions (private; nobody needs EXECUTE on them)
-- ---------------------------------------------------------------------
create or replace function private.lot_touch_updated_at()
returns trigger language plpgsql set search_path = private, public as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Manufacturers live in a car-lot yard and never move.
create or replace function private.manufacturers_guard()
returns trigger language plpgsql security definer set search_path = private, public as $$
begin
  if tg_op = 'UPDATE' and new.yard_id is distinct from old.yard_id then
    raise exception 'a manufacturer cannot move to another yard';
  end if;
  if private.yard_kind(new.yard_id) is distinct from 'vehicle' then
    raise exception 'manufacturers belong to a car-lot yard';
  end if;
  return new;
end $$;

-- Only a super admin (or the service role) attaches a user to a manufacturer.
-- Replaces revision 1's edit of the profiles_update_self policy.
create or replace function private.profiles_guard_manufacturer()
returns trigger language plpgsql security definer set search_path = private, public as $$
begin
  if new.manufacturer_id is distinct from old.manufacturer_id
     and auth.uid() is not null
     and not coalesce(is_super_admin(auth.uid()), false) then
    raise exception 'only a super admin can change which manufacturer a user belongs to';
  end if;
  return new;
end $$;

-- A vehicle with history keeps its manufacturer and yard: its visits,
-- inspections and photo folders are filed under them.
create or replace function private.vehicles_guard()
returns trigger language plpgsql security definer set search_path = private, public as $$
begin
  if (new.manufacturer_id, new.yard_id) is distinct from (old.manufacturer_id, old.yard_id)
     and exists (select 1 from public.vehicle_visits v where v.vehicle_id = old.id) then
    raise exception 'this vehicle already has visits; its manufacturer cannot change';
  end if;
  return new;
end $$;

-- yard_id / manufacturer_id always come from the vehicle, never the client.
create or replace function private.vehicle_visits_guard()
returns trigger language plpgsql security definer set search_path = private, public as $$
declare v record;
begin
  if tg_op = 'INSERT' then
    select yard_id, manufacturer_id into v from public.vehicles where id = new.vehicle_id;
    if not found then raise exception 'vehicle not found'; end if;
    new.yard_id := v.yard_id;
    new.manufacturer_id := v.manufacturer_id;
    new.created_by := coalesce(auth.uid(), new.created_by);
    if new.status = 'out' then raise exception 'a new visit cannot start as out'; end if;
    return new;
  end if;
  -- UPDATE
  if new.vehicle_id is distinct from old.vehicle_id then
    raise exception 'a visit cannot move to another vehicle';
  end if;
  new.yard_id := old.yard_id;
  new.manufacturer_id := old.manufacturer_id;
  new.created_by := old.created_by;
  new.ticket_number := old.ticket_number;
  if old.status = 'out' and new.status <> 'out' then
    raise exception 'a released vehicle''s visit cannot be reopened';
  end if;
  if old.status = 'on-hold' and new.status = 'out' then
    raise exception 'this vehicle is on hold; release the hold before gate-out';
  end if;
  if new.status = 'out' and old.status <> 'out' then
    new.gate_out_time := coalesce(new.gate_out_time, now());
    new.gated_out_by := coalesce(auth.uid(), new.gated_out_by);
  end if;
  return new;
end $$;

create or replace function private.vehicle_inspections_guard()
returns trigger language plpgsql security definer set search_path = private, public as $$
declare v record;
begin
  if tg_op = 'DELETE' then
    raise exception 'inspections cannot be deleted';
  elsif tg_op = 'INSERT' then
    select vehicle_id, yard_id, manufacturer_id, status into v
      from public.vehicle_visits where id = new.visit_id;
    if not found then raise exception 'visit not found'; end if;
    if v.status = 'out' then raise exception 'this visit is closed (vehicle released)'; end if;
    new.vehicle_id := v.vehicle_id;
    new.yard_id := v.yard_id;
    new.manufacturer_id := v.manufacturer_id;
    new.inspector_id := coalesce(auth.uid(), new.inspector_id);
    new.status := 'open';
    new.closed_at := null;
  else -- UPDATE
    if old.status = 'closed' then
      raise exception 'a closed inspection is read-only';
    end if;
    new.visit_id := old.visit_id;
    new.vehicle_id := old.vehicle_id;
    new.yard_id := old.yard_id;
    new.manufacturer_id := old.manufacturer_id;
    new.phase := old.phase;
    new.inspector_id := old.inspector_id;
    new.created_at := old.created_at;
    if new.status = 'closed' then new.closed_at := now(); end if;
  end if;
  return new;
end $$;

create or replace function private.vehicle_inspection_photos_guard()
returns trigger language plpgsql security definer set search_path = private, public as $$
declare i record; prefix text;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    raise exception 'inspection photos are immutable; add a new photo with a note instead';
  end if;
  select vehicle_id, yard_id, manufacturer_id, phase, status into i
    from public.vehicle_inspections where id = new.inspection_id;
  if not found then raise exception 'inspection not found'; end if;
  if i.status <> 'open' then raise exception 'inspection is closed'; end if;
  new.vehicle_id := i.vehicle_id;
  new.yard_id := i.yard_id;
  new.manufacturer_id := i.manufacturer_id;
  new.phase := i.phase;
  new.taken_by := coalesce(auth.uid(), new.taken_by);
  new.created_at := now();
  prefix := i.manufacturer_id::text || '/' || i.vehicle_id::text || '/' || new.inspection_id::text || '/';
  if left(new.storage_path, length(prefix)) <> prefix then
    raise exception 'storage_path must start with %', prefix;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 5. Tables
-- ---------------------------------------------------------------------
create trigger manufacturers_guard_trg before insert or update on public.manufacturers
  for each row execute function private.manufacturers_guard();

create trigger profiles_guard_manufacturer_trg before update on public.profiles
  for each row execute function private.profiles_guard_manufacturer();

-- Vehicles (the unit master, like public.containers)
create table public.vehicles (
  id              uuid primary key default gen_random_uuid(),
  vin             text not null unique
                  check (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),   -- 17 chars, no I/O/Q
  manufacturer_id uuid not null,
  yard_id         uuid not null references public.yards(id),
  model           text,
  model_year      integer check (model_year between 1980 and 2100),
  color           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  -- the manufacturer must belong to the same (car-lot) yard as the vehicle
  foreign key (manufacturer_id, yard_id) references public.manufacturers (id, yard_id)
);
create index vehicles_manufacturer_yard_idx on public.vehicles (manufacturer_id, yard_id);
create index vehicles_yard_idx on public.vehicles (yard_id);
create trigger vehicles_touch before update on public.vehicles
  for each row execute function private.lot_touch_updated_at();
alter table public.vehicles enable row level security;

-- Vehicle visits (like public.container_visits)
create sequence public.vehicle_visit_ticket_seq;
grant usage, select on sequence public.vehicle_visit_ticket_seq to authenticated;

create table public.vehicle_visits (
  id                    uuid primary key default gen_random_uuid(),
  vehicle_id            uuid not null references public.vehicles(id),
  yard_id               uuid not null references public.yards(id),          -- set by trigger
  manufacturer_id       uuid not null references public.manufacturers(id),  -- set by trigger
  status                text not null default 'in-lot'
                        check (status in ('in-lot', 'on-hold', 'out')),
  gate_in_time          timestamptz not null default now(),
  gate_out_time         timestamptz,
  lot_zone              text,
  lot_slot              text,
  is_running            boolean,
  odometer_in           integer,
  odometer_out          integer,
  key_count             integer,
  driver_name           text,
  truck_number          text,
  gate_out_driver_name  text,
  gate_out_truck_number text,
  free_days             integer not null default 7,
  daily_rate            numeric,
  fees                  numeric,
  ticket_number         integer not null unique
                        default nextval('public.vehicle_visit_ticket_seq'),
  created_by            uuid not null default auth.uid() references auth.users(id),
  gated_out_by          uuid references auth.users(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
alter sequence public.vehicle_visit_ticket_seq owned by public.vehicle_visits.ticket_number;
-- A car can only be in the lot once at a time.
create unique index vehicle_visits_one_open_per_vehicle
  on public.vehicle_visits (vehicle_id) where status in ('in-lot', 'on-hold');
create index vehicle_visits_vehicle_idx on public.vehicle_visits (vehicle_id);
create index vehicle_visits_yard_status_idx on public.vehicle_visits (yard_id, status);
create index vehicle_visits_manufacturer_status_idx on public.vehicle_visits (manufacturer_id, status);
create index vehicle_visits_created_by_idx on public.vehicle_visits (created_by);
create index vehicle_visits_gated_out_by_idx on public.vehicle_visits (gated_out_by);
create trigger vehicle_visits_guard_trg before insert or update on public.vehicle_visits
  for each row execute function private.vehicle_visits_guard();
create trigger vehicle_visits_touch before update on public.vehicle_visits
  for each row execute function private.lot_touch_updated_at();
alter table public.vehicle_visits enable row level security;

-- The vehicle guard needs vehicle_visits to exist.
create trigger vehicles_guard_trg before update on public.vehicles
  for each row execute function private.vehicles_guard();

-- Inspections (one per visit per phase) - read-only once closed
create table public.vehicle_inspections (
  id              uuid primary key default gen_random_uuid(),
  visit_id        uuid not null references public.vehicle_visits(id),
  vehicle_id      uuid not null references public.vehicles(id),             -- set by trigger
  yard_id         uuid not null references public.yards(id),                -- set by trigger
  manufacturer_id uuid not null references public.manufacturers(id),        -- set by trigger
  phase           text not null check (phase in ('gate_in', 'gate_out')),
  status          text not null default 'open' check (status in ('open', 'closed')),
  odometer        integer,
  fuel_level      text,
  keys_present    boolean,
  notes           text,
  inspector_id    uuid not null default auth.uid() references auth.users(id),
  created_at      timestamptz not null default now(),
  closed_at       timestamptz,
  unique (visit_id, phase)
);
create index vehicle_inspections_vehicle_idx on public.vehicle_inspections (vehicle_id);
create index vehicle_inspections_yard_idx on public.vehicle_inspections (yard_id);
create index vehicle_inspections_manufacturer_idx on public.vehicle_inspections (manufacturer_id);
create index vehicle_inspections_inspector_idx on public.vehicle_inspections (inspector_id);
create trigger vehicle_inspections_guard_trg
  before insert or update or delete on public.vehicle_inspections
  for each row execute function private.vehicle_inspections_guard();
alter table public.vehicle_inspections enable row level security;

-- Inspection photos - insert-only evidence
create table public.vehicle_inspection_photos (
  id              uuid primary key default gen_random_uuid(),
  inspection_id   uuid not null references public.vehicle_inspections(id),
  vehicle_id      uuid not null references public.vehicles(id),             -- set by trigger
  yard_id         uuid not null references public.yards(id),                -- set by trigger
  manufacturer_id uuid not null references public.manufacturers(id),        -- set by trigger
  phase           text not null check (phase in ('gate_in', 'gate_out')),   -- set by trigger
  angle           text not null,      -- front_left, rear, roof, dashboard, keys, damage ...
  storage_path    text not null unique,
  note            text,
  file_sha256     text check (file_sha256 ~ '^[0-9a-f]{64}$'),
  taken_by        uuid not null default auth.uid() references auth.users(id),
  created_at      timestamptz not null default now()   -- SERVER time, set by trigger
);
create index vehicle_inspection_photos_inspection_idx on public.vehicle_inspection_photos (inspection_id);
create index vehicle_inspection_photos_vehicle_idx on public.vehicle_inspection_photos (vehicle_id);
create index vehicle_inspection_photos_yard_idx on public.vehicle_inspection_photos (yard_id);
create index vehicle_inspection_photos_manufacturer_idx on public.vehicle_inspection_photos (manufacturer_id);
create index vehicle_inspection_photos_taken_by_idx on public.vehicle_inspection_photos (taken_by);
create trigger vehicle_inspection_photos_guard_trg
  before insert or update or delete on public.vehicle_inspection_photos
  for each row execute function private.vehicle_inspection_photos_guard();
alter table public.vehicle_inspection_photos enable row level security;

-- ---------------------------------------------------------------------
-- 6. Car-lot table policies. No DELETE policy anywhere = nobody deletes
--    through the API. (select ...) makes each helper run once per query.
--      read : owner, staff of that car lot, or the row's manufacturer
--      write: owner, or yard admin / inspector of that car lot
-- ---------------------------------------------------------------------
create policy manufacturers_select on public.manufacturers for select to authenticated
  using ((select private.lot_is_owner())
         or yard_id = (select private.lot_staff_yard())
         or id = (select private.current_manufacturer_id()));
create policy manufacturers_insert on public.manufacturers for insert to authenticated
  with check ((select private.lot_is_owner()) or yard_id = (select private.lot_admin_yard()));
create policy manufacturers_update on public.manufacturers for update to authenticated
  using ((select private.lot_is_owner()) or yard_id = (select private.lot_admin_yard()))
  with check ((select private.lot_is_owner()) or yard_id = (select private.lot_admin_yard()));

create policy vehicles_select on public.vehicles for select to authenticated
  using ((select private.lot_is_owner())
         or yard_id = (select private.lot_staff_yard())
         or manufacturer_id = (select private.current_manufacturer_id()));
create policy vehicles_insert on public.vehicles for insert to authenticated
  with check ((select private.lot_is_owner()) or yard_id = (select private.lot_writer_yard()));
create policy vehicles_update on public.vehicles for update to authenticated
  using ((select private.lot_is_owner()) or yard_id = (select private.lot_writer_yard()))
  with check ((select private.lot_is_owner()) or yard_id = (select private.lot_writer_yard()));

create policy vehicle_visits_select on public.vehicle_visits for select to authenticated
  using ((select private.lot_is_owner())
         or yard_id = (select private.lot_staff_yard())
         or manufacturer_id = (select private.current_manufacturer_id()));
create policy vehicle_visits_insert on public.vehicle_visits for insert to authenticated
  with check (created_by = (select auth.uid())
              and ((select private.lot_is_owner()) or yard_id = (select private.lot_writer_yard())));
create policy vehicle_visits_update on public.vehicle_visits for update to authenticated
  using ((select private.lot_is_owner()) or yard_id = (select private.lot_writer_yard()))
  with check ((select private.lot_is_owner()) or yard_id = (select private.lot_writer_yard()));

create policy vehicle_inspections_select on public.vehicle_inspections for select to authenticated
  using ((select private.lot_is_owner())
         or yard_id = (select private.lot_staff_yard())
         or manufacturer_id = (select private.current_manufacturer_id()));
create policy vehicle_inspections_insert on public.vehicle_inspections for insert to authenticated
  with check ((select private.lot_is_owner()) or yard_id = (select private.lot_writer_yard()));
create policy vehicle_inspections_update on public.vehicle_inspections for update to authenticated
  using ((select private.lot_is_owner()) or yard_id = (select private.lot_writer_yard()))
  with check ((select private.lot_is_owner()) or yard_id = (select private.lot_writer_yard()));

create policy vehicle_inspection_photos_select on public.vehicle_inspection_photos for select to authenticated
  using ((select private.lot_is_owner())
         or yard_id = (select private.lot_staff_yard())
         or manufacturer_id = (select private.current_manufacturer_id()));
create policy vehicle_inspection_photos_insert on public.vehicle_inspection_photos for insert to authenticated
  with check ((select private.lot_is_owner()) or yard_id = (select private.lot_writer_yard()));
-- no update / delete policy on purpose

-- ---------------------------------------------------------------------
-- 7. Photo files live in Cloudflare R2 (decision B), bucket
--    'vehicle-inspections', separate from the container photos' R2 bucket.
--    The Worker stores and serves the files; Postgres decides who may do
--    what, because the Worker calls it with the USER'S OWN login:
--      upload: vehicle_photo_upload_prefix(inspection) -> key prefix, or
--              refused; Worker stores the file at <prefix><random>.jpg,
--              then inserts the vehicle_inspection_photos row with the
--              user's login (RLS + guard trigger check again; if that insert
--              fails the Worker deletes the file).
--      view:   Worker reads the photo ROW by id with the user's login and
--              streams the file only if RLS returned the row. It never takes
--              an object key from the browser.
--      delete: no route. Photos are evidence.
--    storage_path in vehicle_inspection_photos is the R2 object key.
-- ---------------------------------------------------------------------
create or replace function public.vehicle_photo_upload_prefix(_inspection_id uuid)
returns text language plpgsql stable security definer set search_path = private, public as $$
declare i record;
begin
  select id, vehicle_id, manufacturer_id, yard_id, status into i
    from public.vehicle_inspections where id = _inspection_id;
  -- same answer for "doesn't exist" and "not yours", so nothing leaks.
  -- coalesce: lot_writer_yard() is NULL for everyone but lot writers, and
  -- NOT (... OR NULL) is NULL, which IF would treat as "allowed".
  if not found
     or not coalesce(private.lot_is_owner() or i.yard_id = private.lot_writer_yard(), false) then
    raise exception 'not allowed to add photos to this inspection' using errcode = '42501';
  end if;
  if i.status <> 'open' then
    raise exception 'inspection is closed' using errcode = '42501';
  end if;
  return i.manufacturer_id::text || '/' || i.vehicle_id::text || '/' || i.id::text || '/';
end $$;

-- ---------------------------------------------------------------------
-- 8. Fences around the EXISTING container side
--    RESTRICTIVE policies are ANDed with the existing ones. For everyone
--    except car-lot staff and manufacturer users they are always true, so
--    container-yard users and the owner are unaffected (verified on a
--    replica: same rows visible, same results for 15 everyday actions).
-- ---------------------------------------------------------------------
do $fence$
declare t text;
begin
  foreach t in array array[
    'containers', 'container_visits', 'inspector_checks', 'bookings',
    'demurrage_payments', 'container_port_data', 'edi_transmissions',
    'shipping_line_transfers', 'cash_counts', 'accounting_month_closes',
    'shipping_lines'
  ] loop
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated
         using ((select private.container_side_allowed()))
         with check ((select private.container_side_allowed()))',
      t || '_block_vehicle_side', t);
  end loop;
end $fence$;

-- Older container photos and every transfer receipt are still in Supabase
-- Storage, so those two buckets are fenced too.
create policy container_buckets_block_vehicle_side on storage.objects
  as restrictive for all to authenticated
  using (bucket_id not in ('inspection-photos', 'transfer-receipts')
         or (select private.container_side_allowed()))
  with check (bucket_id not in ('inspection-photos', 'transfer-receipts')
              or (select private.container_side_allowed()));

-- ---------------------------------------------------------------------
-- 9. Who may call what. New functions are not callable by anon at all.
--    Signed-in users may run the policy helpers (policies run as the caller;
--    the private schema is not exposed over the REST API) and
--    vehicle_photo_upload_prefix(), which only answers for the caller.
-- ---------------------------------------------------------------------
revoke all on function
  private.yard_kind(uuid), private.is_manufacturer_rep(uuid), private.current_manufacturer_id(),
  private.lot_staff_yard(), private.lot_writer_yard(), private.lot_admin_yard(), private.lot_is_owner(),
  private.is_vehicle_side_user(uuid), private.container_side_allowed(),
  public.vehicle_photo_upload_prefix(uuid),
  private.lot_touch_updated_at(), private.manufacturers_guard(), private.profiles_guard_manufacturer(),
  private.vehicles_guard(), private.vehicle_visits_guard(), private.vehicle_inspections_guard(),
  private.vehicle_inspection_photos_guard()
from public, anon, authenticated;

grant execute on function
  private.yard_kind(uuid), private.is_manufacturer_rep(uuid), private.current_manufacturer_id(),
  private.lot_staff_yard(), private.lot_writer_yard(), private.lot_admin_yard(), private.lot_is_owner(),
  private.is_vehicle_side_user(uuid), private.container_side_allowed(),
  public.vehicle_photo_upload_prefix(uuid)
to authenticated, service_role;

commit;

-- =====================================================================
-- AFTER APPLYING - sanity checks (run as separate statements)
--   select code, kind from public.yards;                    -- expect evl/container + evl-cars/vehicle
--   select tablename, policyname, permissive, cmd from pg_policies
--    where policyname like '%block_vehicle_side' or tablename like 'vehicle%' or tablename = 'manufacturers';
--   -- then run docs/car-lot/tests/rls_matrix.sql on the BRANCH (never production data).
-- ROLLBACK: docs/car-lot/car-lot-rollback.sql (only while no real car-lot data exists).
-- =====================================================================
