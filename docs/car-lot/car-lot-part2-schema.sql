-- =====================================================================
-- CAR LOT - PART 2 of 2  (schema, RLS, storage)
-- Project: Container Yard (qctvjwlaxnidprhcxodj)
-- STATUS: draft, NOT applied anywhere, NOT yet tested. Test on a
--         Supabase branch first.
-- Run only AFTER part 1 has been committed.
--
-- Design in one paragraph
--   * The car lot is a second row in public.yards (kind = 'vehicle').
--     Staff are separated from the container yard by yard_id, exactly
--     like today.
--   * Manufacturers are sub-tenants INSIDE the car-lot yard
--     (public.manufacturers). A manufacturer user has role
--     'manufacturer_rep', profiles.yard_id = NULL and
--     profiles.manufacturer_id = <their manufacturer>. Because
--     yard_id is NULL, every existing yard-scoped policy denies them
--     by default; they only get access through the new policies below.
--   * Photos live in a new private bucket 'vehicle-inspections',
--     foldered {manufacturer_id}/{vehicle_id}/{inspection_id}/file.
--     Nobody can update or delete a photo through the API.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 0. Location kind + the car lot as a second yard
-- ---------------------------------------------------------------------
alter table public.yards
  add column if not exists kind text not null default 'container'
  check (kind in ('container', 'vehicle'));

-- created_by is NOT NULL, so borrow the first super_admin. If there is
-- no super_admin row this inserts nothing - check the yard exists after.
insert into public.yards (name, code, kind, created_by)
select 'Everest Logistics - Car Lot', 'evl-cars', 'vehicle', ur.user_id
from public.user_roles ur
where ur.role = 'super_admin'
order by ur.user_id
limit 1
on conflict (code) do nothing;

-- ---------------------------------------------------------------------
-- 1. Manufacturers (client tenants inside the car lot)
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
  unique (yard_id, code)
);
alter table public.manufacturers enable row level security;

alter table public.profiles
  add column if not exists manufacturer_id uuid references public.manufacturers(id);

-- A profile is either car-lot/container staff (yard_id) or a manufacturer
-- user (manufacturer_id), never both.
alter table public.profiles
  add constraint profiles_manufacturer_xor_yard
  check (manufacturer_id is null or yard_id is null);

-- ---------------------------------------------------------------------
-- 2. Helper functions (same SECURITY DEFINER style as your existing ones)
-- ---------------------------------------------------------------------
create or replace function public.current_manufacturer_id()
returns uuid language sql stable security definer set search_path = public as $$
  select manufacturer_id from public.profiles where user_id = auth.uid() limit 1;
$$;

create or replace function public.is_manufacturer_rep(_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_roles where user_id = _uid and role = 'manufacturer_rep'
  );
$$;

-- "Car-lot side" = manufacturer users + staff whose yard is a vehicle yard.
create or replace function public.is_vehicle_side_user(_uid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_manufacturer_rep(_uid)
      or exists (select 1 from public.profiles p
                 where p.user_id = _uid and p.manufacturer_id is not null)
      or exists (select 1 from public.profiles p
                 join public.yards y on y.id = p.yard_id
                 where p.user_id = _uid and y.kind = 'vehicle');
$$;

-- Who may READ a car-lot row: owner, staff of that yard, or the
-- manufacturer the row belongs to.
create or replace function public.can_read_lot_row(_yard uuid, _manufacturer uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    public.is_super_admin(auth.uid())
    or _yard = public.current_yard_id()
    or (_manufacturer is not null and _manufacturer = public.current_manufacturer_id()),
    false);
$$;

-- Who may WRITE a car-lot row: owner, or yard admin / inspector of that yard.
-- (Office role 'user' is read-only for now - see decisions in the notes.)
create or replace function public.can_write_lot_row(_yard uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    public.is_super_admin(auth.uid())
    or (
      _yard = public.current_yard_id()
      and not public.is_manufacturer_rep(auth.uid())
      and (public.is_yard_admin(auth.uid(), _yard)
           or public.has_role(auth.uid(), 'inspector'))
    ),
    false);
$$;

create or replace function public.lot_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 3. Vehicles (the unit master, like public.containers)
-- ---------------------------------------------------------------------
create table public.vehicles (
  id              uuid primary key default gen_random_uuid(),
  vin             text not null unique
                  check (vin ~ '^[A-HJ-NPR-Z0-9]{17}$'),   -- 17 chars, no I/O/Q
  manufacturer_id uuid not null references public.manufacturers(id),
  yard_id         uuid not null references public.yards(id),
  model           text,
  model_year      integer check (model_year between 1980 and 2100),
  color           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index vehicles_manufacturer_idx on public.vehicles (manufacturer_id);
create index vehicles_yard_idx on public.vehicles (yard_id);
create trigger vehicles_touch before update on public.vehicles
  for each row execute function public.lot_touch_updated_at();
alter table public.vehicles enable row level security;

-- ---------------------------------------------------------------------
-- 4. Vehicle visits (like public.container_visits)
-- ---------------------------------------------------------------------
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
  created_by            uuid not null references auth.users(id),
  gated_out_by          uuid references auth.users(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
-- A car can only be in the lot once at a time.
create unique index vehicle_visits_one_open_per_vehicle
  on public.vehicle_visits (vehicle_id) where status in ('in-lot', 'on-hold');
create index vehicle_visits_yard_status_idx on public.vehicle_visits (yard_id, status);
create index vehicle_visits_manufacturer_status_idx on public.vehicle_visits (manufacturer_id, status);
create trigger vehicle_visits_touch before update on public.vehicle_visits
  for each row execute function public.lot_touch_updated_at();
alter table public.vehicle_visits enable row level security;

-- yard_id / manufacturer_id always come from the vehicle, never from the client.
create or replace function public.vehicle_visits_set_scope()
returns trigger language plpgsql security definer set search_path = public as $$
declare v record;
begin
  select yard_id, manufacturer_id into v from public.vehicles where id = new.vehicle_id;
  if not found then raise exception 'vehicle not found'; end if;
  new.yard_id := v.yard_id;
  new.manufacturer_id := v.manufacturer_id;
  return new;
end $$;
create trigger vehicle_visits_scope before insert on public.vehicle_visits
  for each row execute function public.vehicle_visits_set_scope();

-- ---------------------------------------------------------------------
-- 5. Inspections (one per visit per phase) - read-only once closed
-- ---------------------------------------------------------------------
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
  inspector_id    uuid not null references auth.users(id),
  created_at      timestamptz not null default now(),
  closed_at       timestamptz,
  unique (visit_id, phase)
);
create index vehicle_inspections_vehicle_idx on public.vehicle_inspections (vehicle_id);
create index vehicle_inspections_manufacturer_idx on public.vehicle_inspections (manufacturer_id);
alter table public.vehicle_inspections enable row level security;

create or replace function public.vehicle_inspections_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if tg_op = 'DELETE' then
    raise exception 'inspections cannot be deleted';
  elsif tg_op = 'INSERT' then
    select vehicle_id, yard_id, manufacturer_id into v
      from public.vehicle_visits where id = new.visit_id;
    if not found then raise exception 'visit not found'; end if;
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
    -- scope and identity columns can never change
    new.visit_id := old.visit_id;
    new.vehicle_id := old.vehicle_id;
    new.yard_id := old.yard_id;
    new.manufacturer_id := old.manufacturer_id;
    new.phase := old.phase;
    new.inspector_id := old.inspector_id;
    if new.status = 'closed' then new.closed_at := now(); end if;
  end if;
  return new;
end $$;
create trigger vehicle_inspections_guard_trg
  before insert or update or delete on public.vehicle_inspections
  for each row execute function public.vehicle_inspections_guard();

-- ---------------------------------------------------------------------
-- 6. Inspection photos - insert-only evidence
-- ---------------------------------------------------------------------
create table public.inspection_photos (
  id              uuid primary key default gen_random_uuid(),
  inspection_id   uuid not null references public.vehicle_inspections(id),
  vehicle_id      uuid not null references public.vehicles(id),             -- set by trigger
  yard_id         uuid not null references public.yards(id),                -- set by trigger
  manufacturer_id uuid not null references public.manufacturers(id),        -- set by trigger
  phase           text not null check (phase in ('gate_in', 'gate_out')),   -- set by trigger
  angle           text not null,      -- front_left, rear, roof, dashboard, keys, extra ...
  storage_path    text not null unique,
  note            text,
  file_sha256     text check (file_sha256 ~ '^[0-9a-f]{64}$'),
  taken_by        uuid not null default auth.uid() references auth.users(id),
  created_at      timestamptz not null default now()   -- SERVER time, not the phone's
);
create index inspection_photos_inspection_idx on public.inspection_photos (inspection_id);
create index inspection_photos_manufacturer_idx on public.inspection_photos (manufacturer_id);
alter table public.inspection_photos enable row level security;

create or replace function public.inspection_photos_guard()
returns trigger language plpgsql security definer set search_path = public as $$
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
  prefix := i.manufacturer_id::text || '/' || i.vehicle_id::text || '/' || new.inspection_id::text || '/';
  if left(new.storage_path, length(prefix)) <> prefix then
    raise exception 'storage_path must start with %', prefix;
  end if;
  return new;
end $$;
create trigger inspection_photos_guard_trg
  before insert or update or delete on public.inspection_photos
  for each row execute function public.inspection_photos_guard();

-- ---------------------------------------------------------------------
-- 7. Table policies (no DELETE policies anywhere = nobody deletes via API)
-- ---------------------------------------------------------------------
create policy manufacturers_select on public.manufacturers for select to authenticated
  using (public.can_read_lot_row(yard_id, id));
create policy manufacturers_insert on public.manufacturers for insert to authenticated
  with check (public.is_super_admin(auth.uid()) or public.is_yard_admin(auth.uid(), yard_id));
create policy manufacturers_update on public.manufacturers for update to authenticated
  using (public.is_super_admin(auth.uid()) or public.is_yard_admin(auth.uid(), yard_id))
  with check (public.is_super_admin(auth.uid()) or public.is_yard_admin(auth.uid(), yard_id));

create policy vehicles_select on public.vehicles for select to authenticated
  using (public.can_read_lot_row(yard_id, manufacturer_id));
create policy vehicles_insert on public.vehicles for insert to authenticated
  with check (public.can_write_lot_row(yard_id));
create policy vehicles_update on public.vehicles for update to authenticated
  using (public.can_write_lot_row(yard_id))
  with check (public.can_write_lot_row(yard_id));

create policy vehicle_visits_select on public.vehicle_visits for select to authenticated
  using (public.can_read_lot_row(yard_id, manufacturer_id));
create policy vehicle_visits_insert on public.vehicle_visits for insert to authenticated
  with check (created_by = auth.uid() and public.can_write_lot_row(yard_id));
create policy vehicle_visits_update on public.vehicle_visits for update to authenticated
  using (public.can_write_lot_row(yard_id))
  with check (public.can_write_lot_row(yard_id));

create policy vehicle_inspections_select on public.vehicle_inspections for select to authenticated
  using (public.can_read_lot_row(yard_id, manufacturer_id));
create policy vehicle_inspections_insert on public.vehicle_inspections for insert to authenticated
  with check (public.can_write_lot_row(yard_id));
create policy vehicle_inspections_update on public.vehicle_inspections for update to authenticated
  using (public.can_write_lot_row(yard_id))
  with check (public.can_write_lot_row(yard_id));

create policy inspection_photos_select on public.inspection_photos for select to authenticated
  using (public.can_read_lot_row(yard_id, manufacturer_id));
create policy inspection_photos_insert on public.inspection_photos for insert to authenticated
  with check (public.can_write_lot_row(yard_id));
-- no update / delete policy on purpose

-- ---------------------------------------------------------------------
-- 8. Storage: new private bucket + policies
-- ---------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vehicle-inspections', 'vehicle-inspections', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])
on conflict (id) do nothing;

-- Upload allowed only into an OPEN inspection that the caller may write to,
-- and only to the exact path {manufacturer}/{vehicle}/{inspection}/...
create or replace function public.can_upload_vehicle_photo(_name text)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare
  parts text[] := string_to_array(_name, '/');
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if coalesce(array_length(parts, 1), 0) < 4 then return false; end if;
  if not (parts[1] ~* uuid_re and parts[2] ~* uuid_re and parts[3] ~* uuid_re) then
    return false;
  end if;
  return exists (
    select 1 from public.vehicle_inspections i
    where i.id = parts[3]::uuid
      and i.vehicle_id = parts[2]::uuid
      and i.manufacturer_id = parts[1]::uuid
      and i.status = 'open'
      and public.can_write_lot_row(i.yard_id)
  );
end $$;

create policy vehicle_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'vehicle-inspections' and public.can_upload_vehicle_photo(name));

create policy vehicle_photos_select on storage.objects for select to authenticated
  using (
    bucket_id = 'vehicle-inspections' and (
      public.is_super_admin(auth.uid())
      or (storage.foldername(name))[1] = public.current_manufacturer_id()::text
      or exists (select 1 from public.manufacturers m
                 where m.id::text = (storage.foldername(name))[1]
                   and m.yard_id = public.current_yard_id())
    )
  );
-- no update / delete policy on purpose (also means no upsert: use unique file names)

-- ---------------------------------------------------------------------
-- 9. Fences around the EXISTING container side
--    Found while reading your policies:
--      - public.containers has no yard scoping: any signed-in non-line-rep
--        can read AND update it.
--      - the old 'inspection-photos' and 'transfer-receipts' bucket
--        policies are role-based, not yard-based.
--    Without these fences, car-lot staff and manufacturer users would
--    reach container data. RESTRICTIVE policies are ANDed with the
--    existing ones, so container-yard users and the owner are unaffected.
-- ---------------------------------------------------------------------
create policy containers_block_vehicle_side on public.containers
  as restrictive for all to authenticated
  using (public.is_super_admin(auth.uid()) or not public.is_vehicle_side_user(auth.uid()))
  with check (public.is_super_admin(auth.uid()) or not public.is_vehicle_side_user(auth.uid()));

create policy container_buckets_block_vehicle_side on storage.objects
  as restrictive for all to authenticated
  using (
    bucket_id not in ('inspection-photos', 'transfer-receipts')
    or public.is_super_admin(auth.uid())
    or not public.is_vehicle_side_user(auth.uid())
  )
  with check (
    bucket_id not in ('inspection-photos', 'transfer-receipts')
    or public.is_super_admin(auth.uid())
    or not public.is_vehicle_side_user(auth.uid())
  );

-- ---------------------------------------------------------------------
-- 10. The ONLY change to an existing policy: stop a manufacturer user
--     from editing their own profile to point at another manufacturer.
--     Identical to the current profiles_update_self plus one clause.
-- ---------------------------------------------------------------------
drop policy profiles_update_self on public.profiles;
create policy profiles_update_self on public.profiles for update
  using (auth.uid() = user_id)
  with check (
    auth.uid() = user_id
    and role = 'user'::app_role
    and not (yard_id is distinct from (select p.yard_id from public.profiles p where p.user_id = auth.uid()))
    and not (username is distinct from (select p.username from public.profiles p where p.user_id = auth.uid()))
    and not (shipping_line is distinct from (select p.shipping_line from public.profiles p where p.user_id = auth.uid()))
    and not (manufacturer_id is distinct from (select p.manufacturer_id from public.profiles p where p.user_id = auth.uid()))
  );

commit;

-- =====================================================================
-- AFTER APPLYING - sanity checks (run as separate statements)
--   select code, kind from public.yards;                    -- expect evl + evl-cars
--   select id, public from storage.buckets where id = 'vehicle-inspections';  -- public = false
--   select tablename, policyname, cmd from pg_policies
--     where tablename in ('vehicles','vehicle_visits','vehicle_inspections','inspection_photos');
--   -- then log in as: car-lot inspector, manufacturer A user, manufacturer B user,
--   -- container-yard admin, and confirm each sees only what the notes say.
--
-- ROLLBACK (only if nothing has been loaded yet)
--   drop table public.inspection_photos, public.vehicle_inspections,
--              public.vehicle_visits, public.vehicles cascade;
--   alter table public.profiles drop column manufacturer_id;
--   drop table public.manufacturers;
--   -- plus drop the policies/functions/bucket created above, and restore the
--   -- original profiles_update_self (without the manufacturer_id clause).
-- =====================================================================
