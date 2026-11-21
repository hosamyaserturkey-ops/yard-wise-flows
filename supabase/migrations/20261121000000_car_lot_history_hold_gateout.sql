-- Car lot: hold reason, change history, and no gate-out without a departure inspection.
--
-- 1. HOLD REASON. Putting a car on hold needs a reason; who and when are recorded.
--    Releasing the hold clears them (the history below keeps every hold).
-- 2. HISTORY. Every gate-in, edit, hold, hold release and gate-out of a car is
--    written to public.vehicle_events BY THE DATABASE (triggers), whoever made the
--    change and however (app or API), with the old and new value of each field.
--    Nobody can add, change or delete a history row. The car lot's staff and the
--    owner can read it; manufacturers cannot.
-- 3. EDITING A CAR goes through car_lot_edit_car(): the car lot's admin or the owner
--    only, cars still in the lot only, a fixed list of fields, the car and its visit
--    saved together or not at all, and a reason, which is REQUIRED to change a VIN.
-- 4. GATE-OUT needs a CLOSED departure inspection for that visit.
--
-- Rules 1 and 4 apply to signed-in users only; server jobs (auth.uid() is null),
-- such as the retention job, are not held to them, as with the other guards.

-- ---------------------------------------------------------------------
-- 1. Hold reason on the visit
-- ---------------------------------------------------------------------
alter table public.vehicle_visits
  add column if not exists hold_reason text,
  add column if not exists held_at     timestamptz,
  add column if not exists held_by     uuid references auth.users(id);
create index if not exists vehicle_visits_held_by_idx on public.vehicle_visits (held_by);

-- ---------------------------------------------------------------------
-- 2. History table
-- ---------------------------------------------------------------------
create table public.vehicle_events (
  id              bigint generated always as identity primary key,
  at              timestamptz not null default now(),
  actor           uuid references auth.users(id),   -- null: a server job
  actor_name      text,                             -- as it was when the change was made
  visit_id        uuid references public.vehicle_visits(id) on delete cascade,
  vehicle_id      uuid not null,
  yard_id         uuid not null references public.yards(id),
  manufacturer_id uuid not null,
  action          text not null check (action in ('gate_in', 'edit', 'hold', 'release_hold', 'gate_out')),
  changes         jsonb not null default '{}'::jsonb, -- {"field": [old, new], ...}
  reason          text
);
create index vehicle_events_visit_idx   on public.vehicle_events (visit_id, at);
create index vehicle_events_vehicle_idx on public.vehicle_events (vehicle_id, at);
create index vehicle_events_yard_idx    on public.vehicle_events (yard_id);
create index vehicle_events_actor_idx   on public.vehicle_events (actor);
alter table public.vehicle_events enable row level security;
create policy vehicle_events_select on public.vehicle_events for select to authenticated
  using ((select private.lot_is_owner()) or yard_id = (select private.lot_staff_yard()));
-- no insert, update or delete policy: only the triggers below write it.

-- The reason an edit was made, set by car_lot_edit_car() for its own transaction only.
create or replace function private.car_lot_reason()
returns text language sql stable set search_path = private, public as $$
  select nullif(btrim(current_setting('car_lot.reason', true)), '');
$$;

create or replace function private.car_lot_actor_name()
returns text language sql stable security definer set search_path = private, public as $$
  select coalesce(p.full_name, p.username) from public.profiles p where p.user_id = auth.uid() limit 1;
$$;

-- {"field": [old, new]} for each listed field that changed.
create or replace function private.jsonb_changes(_old jsonb, _new jsonb, _fields text[])
returns jsonb language sql immutable set search_path = private, public as $$
  select coalesce(jsonb_object_agg(f, jsonb_build_array(_old -> f, _new -> f)), '{}'::jsonb)
    from unnest(_fields) f
   where (_old -> f) is distinct from (_new -> f);
$$;

-- ---------------------------------------------------------------------
-- 3. Visit guard: the existing rules, plus the hold reason and the gate-out rule
-- ---------------------------------------------------------------------
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
    if new.status = 'on-hold' then
      if auth.uid() is not null and nullif(btrim(new.hold_reason), '') is null then
        raise exception 'a reason is required to put a car on hold';
      end if;
      new.hold_reason := nullif(btrim(new.hold_reason), '');
      new.held_at := now();
      new.held_by := auth.uid();
    else
      new.hold_reason := null; new.held_at := null; new.held_by := null;
    end if;
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
  -- hold: a reason going in, who and when set by the server; cleared on release
  if new.status = 'on-hold' and old.status <> 'on-hold' then
    if auth.uid() is not null and nullif(btrim(new.hold_reason), '') is null then
      raise exception 'a reason is required to put a car on hold';
    end if;
    new.hold_reason := nullif(btrim(new.hold_reason), '');
    new.held_at := now();
    new.held_by := auth.uid();
  elsif new.status = 'on-hold' then
    new.hold_reason := old.hold_reason; new.held_at := old.held_at; new.held_by := old.held_by;
  else
    new.hold_reason := null; new.held_at := null; new.held_by := null;
  end if;
  if new.status = 'out' and old.status <> 'out' then
    if auth.uid() is not null and not exists (
      select 1 from public.vehicle_inspections i
       where i.visit_id = new.id and i.phase = 'gate_out' and i.status = 'closed'
    ) then
      raise exception 'close the departure inspection before gate-out';
    end if;
    new.gate_out_time := coalesce(new.gate_out_time, now());
    new.gated_out_by := coalesce(auth.uid(), new.gated_out_by);
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 4. History triggers
-- ---------------------------------------------------------------------
create or replace function private.vehicle_visits_history()
returns trigger language plpgsql security definer set search_path = private, public as $$
declare ch jsonb; act text; why text;
begin
  if tg_op = 'INSERT' then
    insert into public.vehicle_events (actor, actor_name, visit_id, vehicle_id, yard_id, manufacturer_id, action, changes, reason)
    values (auth.uid(), private.car_lot_actor_name(), new.id, new.vehicle_id, new.yard_id, new.manufacturer_id, 'gate_in', '{}'::jsonb, null);
    return new;
  end if;
  ch := private.jsonb_changes(to_jsonb(old), to_jsonb(new), array[
    'status', 'lot_zone', 'lot_slot', 'odometer_in', 'odometer_out', 'key_count', 'driver_name', 'truck_number',
    'gate_out_driver_name', 'gate_out_truck_number', 'free_days', 'daily_rate', 'fees', 'hold_reason', 'gate_in_time']);
  if ch = '{}'::jsonb then return new; end if;
  act := case
    when new.status = 'out' and old.status <> 'out' then 'gate_out'
    when new.status = 'on-hold' and old.status <> 'on-hold' then 'hold'
    when old.status = 'on-hold' and new.status <> 'on-hold' then 'release_hold'
    else 'edit' end;
  why := case when act = 'hold' then new.hold_reason else private.car_lot_reason() end;
  insert into public.vehicle_events (actor, actor_name, visit_id, vehicle_id, yard_id, manufacturer_id, action, changes, reason)
  values (auth.uid(), private.car_lot_actor_name(), new.id, new.vehicle_id, new.yard_id, new.manufacturer_id, act, ch, why);
  return new;
end $$;

create or replace function private.vehicles_history()
returns trigger language plpgsql security definer set search_path = private, public as $$
declare ch jsonb; vis uuid;
begin
  ch := private.jsonb_changes(to_jsonb(old), to_jsonb(new), array['vin', 'model', 'model_year', 'color']);
  if ch = '{}'::jsonb then return new; end if;
  if ch ? 'vin' and auth.uid() is not null and private.car_lot_reason() is null then
    raise exception 'a reason is required to change a VIN';
  end if;
  -- file the change under the car's latest visit, so it shows in that visit's history
  select id into vis from public.vehicle_visits where vehicle_id = new.id order by gate_in_time desc limit 1;
  insert into public.vehicle_events (actor, actor_name, visit_id, vehicle_id, yard_id, manufacturer_id, action, changes, reason)
  values (auth.uid(), private.car_lot_actor_name(), vis, new.id, new.yard_id, new.manufacturer_id, 'edit', ch, private.car_lot_reason());
  return new;
end $$;

create trigger vehicle_visits_history_trg after insert or update on public.vehicle_visits
  for each row execute function private.vehicle_visits_history();
create trigger vehicles_history_trg after update on public.vehicles
  for each row execute function private.vehicles_history();

-- ---------------------------------------------------------------------
-- 5. Editing a car: one controlled way, for the lot's admin or the owner
-- ---------------------------------------------------------------------
create or replace function public.car_lot_edit_car(_visit_id uuid, _vehicle jsonb, _visit jsonb, _reason text default null)
returns void language plpgsql security invoker set search_path = private, public as $$
declare
  v record;
  k text;
  vehicle_fields constant text[] := array['vin', 'model', 'model_year', 'color'];
  visit_fields   constant text[] := array['lot_zone', 'lot_slot', 'odometer_in', 'key_count', 'driver_name', 'truck_number', 'free_days'];
  is_owner boolean := coalesce(is_super_admin(auth.uid()), false);
begin
  _vehicle := coalesce(_vehicle, '{}'::jsonb);
  _visit := coalesce(_visit, '{}'::jsonb);
  if not is_owner and private.lot_admin_yard() is null then
    raise exception 'only the car lot''s admin or the owner can edit a car' using errcode = '42501';
  end if;
  -- runs as the caller: row-level security decides which visits they can even see
  select id, vehicle_id, status, yard_id into v from public.vehicle_visits where id = _visit_id;
  if not found then raise exception 'car not found' using errcode = '42501'; end if;
  if not is_owner and v.yard_id is distinct from private.lot_admin_yard() then
    raise exception 'only the car lot''s admin or the owner can edit a car' using errcode = '42501';
  end if;
  if v.status = 'out' then raise exception 'a released car cannot be edited'; end if;
  for k in select jsonb_object_keys(_vehicle) loop
    if not k = any (vehicle_fields) then raise exception 'cannot edit %', k; end if;
  end loop;
  for k in select jsonb_object_keys(_visit) loop
    if not k = any (visit_fields) then raise exception 'cannot edit %', k; end if;
  end loop;
  if _visit ? 'free_days' and coalesce((_visit ->> 'free_days')::int, -1) not between 0 and 365 then
    raise exception 'free days must be from 0 to 365';
  end if;

  perform set_config('car_lot.reason', coalesce(btrim(_reason), ''), true);
  if _vehicle <> '{}'::jsonb then
    update public.vehicles set
      vin        = case when _vehicle ? 'vin' then upper(btrim(_vehicle ->> 'vin')) else vin end,
      model      = case when _vehicle ? 'model' then nullif(btrim(_vehicle ->> 'model'), '') else model end,
      model_year = case when _vehicle ? 'model_year' then (_vehicle ->> 'model_year')::int else model_year end,
      color      = case when _vehicle ? 'color' then nullif(btrim(_vehicle ->> 'color'), '') else color end
    where id = v.vehicle_id;
  end if;
  if _visit <> '{}'::jsonb then
    update public.vehicle_visits set
      lot_zone     = case when _visit ? 'lot_zone' then nullif(btrim(_visit ->> 'lot_zone'), '') else lot_zone end,
      lot_slot     = case when _visit ? 'lot_slot' then nullif(btrim(_visit ->> 'lot_slot'), '') else lot_slot end,
      odometer_in  = case when _visit ? 'odometer_in' then (_visit ->> 'odometer_in')::int else odometer_in end,
      key_count    = case when _visit ? 'key_count' then (_visit ->> 'key_count')::int else key_count end,
      driver_name  = case when _visit ? 'driver_name' then nullif(btrim(_visit ->> 'driver_name'), '') else driver_name end,
      truck_number = case when _visit ? 'truck_number' then nullif(btrim(_visit ->> 'truck_number'), '') else truck_number end,
      free_days    = case when _visit ? 'free_days' then (_visit ->> 'free_days')::int else free_days end
    where id = _visit_id;
  end if;
  perform set_config('car_lot.reason', '', true);
end $$;

-- ---------------------------------------------------------------------
-- 6. Who may call what
-- ---------------------------------------------------------------------
revoke all on function
  private.car_lot_reason(), private.car_lot_actor_name(), private.jsonb_changes(jsonb, jsonb, text[]),
  private.vehicle_visits_history(), private.vehicles_history(),
  public.car_lot_edit_car(uuid, jsonb, jsonb, text)
from public, anon, authenticated;
grant execute on function public.car_lot_edit_car(uuid, jsonb, jsonb, text) to authenticated, service_role;
