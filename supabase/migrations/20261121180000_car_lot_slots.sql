-- Car lot: a list of slots, a car placed in a slot (by scanning its QR label,
-- picking it from the list, or typing it), moves recorded in the history, and
-- no slot holding more cars than it has room for.
--
-- 1. SLOTS. public.lot_locations: the car lot's places (zone, optional row and
--    slot number), each with its own printed QR label. The owner and the lot's
--    admin add and change them, the lot's staff read them, nobody else sees
--    them, and nobody deletes them (take a slot out of use instead, so older
--    history keeps its meaning).
-- 2. A CAR'S SLOT. vehicle_visits.location_id. Whenever a car gets a slot the
--    database checks that the slot is in use, in the car's own lot, and not
--    full (a lock per slot stops two phones taking its last place at once).
--    The slot's zone and number are copied into lot_zone / lot_slot, so the
--    tickets, the manufacturer portal, search and reports keep working.
--    Typed spots stay allowed for every member of staff (decided 2026-11-21):
--    a typed spot clears the slot, but a typed spot that IS a listed slot
--    ("b 3 7" for B-03-07) counts as that slot, full-slot rule included.
-- 3. MOVES go through car_lot_move() and are written to vehicle_events as
--    'move', with how the place was chosen (scan / list / typed) and a label of
--    the phone it was done on. Only the lot's admin or the owner can put a car
--    in a full slot, and only with a reason.
-- 4. car_lot_edit_car() leaves the spot of a car in a listed slot alone: use Move.
--
-- As with the other car-lot guards, server jobs (auth.uid() is null) are not
-- held to the full-slot rule.

-- ---------------------------------------------------------------------
-- 1. Normalising slot names
-- ---------------------------------------------------------------------
-- One part of a slot name: trimmed, upper case; a number gets at least two
-- digits when asked ("7" -> "07", "007" -> "07", "112" -> "112").
create or replace function private.lot_slot_part(_part text, _pad boolean)
returns text language sql immutable set search_path = private, public as $$
  select case
    when nullif(btrim(_part), '') is null then null
    when _pad and btrim(_part) ~ '^[0-9]+$' then lpad((btrim(_part)::bigint)::text, 2, '0')
    else upper(btrim(_part)) end;
$$;

-- The printed code: "B-03-07", "B-12", "RECEIVING".
create or replace function private.lot_slot_code(_zone text, _row text, _slot text)
returns text language sql immutable set search_path = private, public as $$
  select concat_ws('-', private.lot_slot_part(_zone, false), private.lot_slot_part(_row, true),
                   private.lot_slot_part(_slot, true));
$$;

-- What a person may type for a place, made comparable: letters and numbers
-- split apart, numbers with at least two digits, joined by "-". "b 3 7",
-- "B3-7" and "b-03-07" all give "B-03-07". src/lib/lotSlots.ts has the same rule.
create or replace function private.lot_spot_key(_text text)
returns text language sql immutable set search_path = private, public as $$
  select nullif(string_agg(case when t ~ '^[0-9]+$' then lpad(ltrim(t, '0'), 2, '0') else t end, '-' order by n), '')
    from regexp_split_to_table(
           regexp_replace(regexp_replace(upper(coalesce(_text, '')), '([A-Z])([0-9])', '\1 \2', 'g'),
                          '([0-9])([A-Z])', '\1 \2', 'g'),
           '[^A-Z0-9]+') with ordinality as s(t, n)
   where t <> '';
$$;

-- ---------------------------------------------------------------------
-- 2. The slot list
-- ---------------------------------------------------------------------
create table public.lot_locations (
  id          uuid primary key default gen_random_uuid(),
  yard_id     uuid not null references public.yards(id),
  zone        text not null check (zone ~ '^[A-Za-z0-9]{1,10}$'),
  row_label   text check (row_label ~ '^[A-Za-z0-9]{1,10}$'),
  slot        text check (slot ~ '^[A-Za-z0-9]{1,10}$'),
  code        text not null,                 -- set by the guard from zone/row/slot
  match_key   text not null,                 -- set by the guard: lot_spot_key(code)
  kind        text not null default 'storage' check (kind in ('receiving', 'storage', 'exit')),
  capacity    integer not null default 1 check (capacity between 1 and 500),
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid default auth.uid() references auth.users(id),
  unique (yard_id, code),
  unique (yard_id, match_key)                -- "A01-1" can't sit next to "A-01-01"
);
create index lot_locations_created_by_idx on public.lot_locations (created_by);
alter table public.lot_locations enable row level security;

alter table public.vehicle_visits
  add column if not exists location_id uuid references public.lot_locations(id);
create index if not exists vehicle_visits_location_idx on public.vehicle_visits (location_id);

-- Cars in the lot now (in the lot or on hold) that have this slot.
create or replace function private.lot_slot_occupants(_location uuid, _except uuid)
returns table (n bigint, vins text)
language sql stable security definer set search_path = private, public as $$
  select count(*), string_agg(ve.vin, ', ' order by vv.gate_in_time)
    from public.vehicle_visits vv join public.vehicles ve on ve.id = vv.vehicle_id
   where vv.location_id = _location and vv.status in ('in-lot', 'on-hold')
     and vv.id is distinct from _except;
$$;

-- Slots live in a car-lot yard and never move; the name is normalised; a slot
-- with cars in it keeps its name, stays in use and keeps room for them.
create or replace function private.lot_locations_guard()
returns trigger language plpgsql security definer set search_path = private, public as $$
declare occ record;
begin
  if tg_op = 'UPDATE' and new.yard_id is distinct from old.yard_id then
    raise exception 'a slot cannot move to another yard';
  end if;
  if private.yard_kind(new.yard_id) is distinct from 'vehicle' then
    raise exception 'slots belong to a car-lot yard';
  end if;
  new.zone := private.lot_slot_part(new.zone, false);
  new.row_label := private.lot_slot_part(new.row_label, true);
  new.slot := private.lot_slot_part(new.slot, true);
  new.code := private.lot_slot_code(new.zone, new.row_label, new.slot);
  new.match_key := private.lot_spot_key(new.code);
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
    return new;
  end if;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  select * into occ from private.lot_slot_occupants(old.id, null);
  if occ.n > 0 then
    if new.code is distinct from old.code then
      raise exception 'slot % holds % (%); move the cars out before renaming it', old.code, occ.n, occ.vins;
    end if;
    if not new.active then
      raise exception 'slot % holds % (%); move the cars out before taking it out of use', old.code, occ.n, occ.vins;
    end if;
    if new.capacity < occ.n then
      raise exception 'slot % holds % cars; its room cannot be less than that', old.code, occ.n;
    end if;
  end if;
  return new;
end $$;

create trigger lot_locations_guard_trg before insert or update on public.lot_locations
  for each row execute function private.lot_locations_guard();

create policy lot_locations_select on public.lot_locations for select to authenticated
  using ((select private.lot_is_owner()) or yard_id = (select private.lot_staff_yard()));
create policy lot_locations_insert on public.lot_locations for insert to authenticated
  with check ((select private.lot_is_owner()) or yard_id = (select private.lot_admin_yard()));
create policy lot_locations_update on public.lot_locations for update to authenticated
  using ((select private.lot_is_owner()) or yard_id = (select private.lot_admin_yard()))
  with check ((select private.lot_is_owner()) or yard_id = (select private.lot_admin_yard()));
-- no delete policy on purpose: take a slot out of use instead

-- ---------------------------------------------------------------------
-- 3. History: moves, how the place was chosen, and on which phone
-- ---------------------------------------------------------------------
alter table public.vehicle_events drop constraint vehicle_events_action_check;
alter table public.vehicle_events add constraint vehicle_events_action_check
  check (action in ('gate_in', 'edit', 'hold', 'release_hold', 'gate_out', 'move'));
alter table public.vehicle_events
  add column if not exists via    text check (via in ('scan', 'list', 'typed')),
  add column if not exists device text check (length(device) <= 40);

-- Set by car_lot_move() for its own transaction only.
create or replace function private.car_lot_setting(_name text)
returns text language sql stable set search_path = private, public as $$
  select nullif(btrim(current_setting('car_lot.' || _name, true)), '');
$$;

-- ---------------------------------------------------------------------
-- 4. Visit guard: every rule of 20261121000000, plus the slot rules
-- ---------------------------------------------------------------------
create or replace function private.vehicle_visits_guard()
returns trigger language plpgsql security definer set search_path = private, public as $$
declare
  v record;
  loc record;
  occ record;
  typed boolean;
  matched uuid;
  may_override boolean;
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
  else
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
  end if;

  -- The car's place: a listed slot (location_id) or a typed spot (lot_zone / lot_slot).
  if tg_op = 'INSERT'
     or new.location_id is distinct from old.location_id
     or new.lot_zone is distinct from old.lot_zone
     or new.lot_slot is distinct from old.lot_slot then
    if tg_op = 'UPDATE' and old.status = 'out' then
      raise exception 'a released car cannot be moved';
    end if;
    -- Typed: no slot chosen, or the text changed while the slot did not.
    typed := new.location_id is null
             or (tg_op = 'UPDATE' and new.location_id is not distinct from old.location_id);
    if typed then
      new.location_id := null;
      new.lot_zone := nullif(btrim(new.lot_zone), '');
      new.lot_slot := nullif(btrim(new.lot_slot), '');
      if concat_ws(' ', new.lot_zone, new.lot_slot) <> '' then
        select l.id into matched from public.lot_locations l
         where l.yard_id = new.yard_id and l.active
           and l.match_key = private.lot_spot_key(concat_ws(' ', new.lot_zone, new.lot_slot));
        new.location_id := matched;   -- stays null when nothing matches
      end if;
    end if;
    if new.location_id is not null then
      select id, yard_id, code, zone, row_label, slot, capacity, active into loc
        from public.lot_locations where id = new.location_id;
      if not found then raise exception 'slot not found'; end if;
      if loc.yard_id is distinct from new.yard_id then
        raise exception 'slot % belongs to another lot', loc.code;
      end if;
      if not loc.active then
        raise exception 'slot % is not in use', loc.code;
      end if;
      -- One at a time per slot, so two phones can't both take its last place.
      perform pg_advisory_xact_lock(hashtextextended('car_lot.slot:' || loc.id::text, 0));
      select * into occ from private.lot_slot_occupants(loc.id, new.id);
      -- coalesce everywhere: a NULL here would quietly skip the rule.
      may_override := coalesce(private.car_lot_setting('override') = 'on', false)
                      and (coalesce(is_super_admin(auth.uid()), false)
                           or coalesce(new.yard_id = private.lot_admin_yard(), false));
      if new.status in ('in-lot', 'on-hold') and occ.n >= loc.capacity
         and auth.uid() is not null and not may_override then
        raise exception 'slot % is full: it holds %', loc.code, occ.vins;
      end if;
      new.lot_zone := loc.zone;
      new.lot_slot := nullif(concat_ws('-', loc.row_label, loc.slot), '');
    end if;
  end if;
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 5. History trigger: 'move' for a move made with car_lot_move() (it says how the
--    place was chosen); a place corrected through an edit stays an 'edit', as before
-- ---------------------------------------------------------------------
create or replace function private.vehicle_visits_history()
returns trigger language plpgsql security definer set search_path = private, public as $$
declare ch jsonb; act text; why text;
begin
  if tg_op = 'INSERT' then
    insert into public.vehicle_events (actor, actor_name, visit_id, vehicle_id, yard_id, manufacturer_id, action, changes, reason, via, device)
    values (auth.uid(), private.car_lot_actor_name(), new.id, new.vehicle_id, new.yard_id, new.manufacturer_id, 'gate_in', '{}'::jsonb, null,
            private.car_lot_setting('via'), private.car_lot_setting('device'));
    return new;
  end if;
  ch := private.jsonb_changes(to_jsonb(old), to_jsonb(new), array[
    'status', 'lot_zone', 'lot_slot', 'location_id', 'odometer_in', 'odometer_out', 'key_count', 'driver_name', 'truck_number',
    'gate_out_driver_name', 'gate_out_truck_number', 'free_days', 'daily_rate', 'fees', 'hold_reason', 'gate_in_time']);
  if ch = '{}'::jsonb then return new; end if;
  act := case
    when new.status = 'out' and old.status <> 'out' then 'gate_out'
    when new.status = 'on-hold' and old.status <> 'on-hold' then 'hold'
    when old.status = 'on-hold' and new.status <> 'on-hold' then 'release_hold'
    when private.car_lot_setting('via') is not null
         and ch - array['lot_zone', 'lot_slot', 'location_id'] = '{}'::jsonb then 'move'
    else 'edit' end;
  why := case when act = 'hold' then new.hold_reason else private.car_lot_reason() end;
  insert into public.vehicle_events (actor, actor_name, visit_id, vehicle_id, yard_id, manufacturer_id, action, changes, reason, via, device)
  values (auth.uid(), private.car_lot_actor_name(), new.id, new.vehicle_id, new.yard_id, new.manufacturer_id, act, ch, why,
          private.car_lot_setting('via'), private.car_lot_setting('device'));
  return new;
end $$;

-- ---------------------------------------------------------------------
-- 6. Moving a car: a listed slot or a typed spot
-- ---------------------------------------------------------------------
create or replace function public.car_lot_move(
  _visit_id uuid,
  _location_id uuid default null,
  _zone text default null,
  _slot text default null,
  _via text default 'list',
  _device text default null,
  _override_reason text default null
) returns text
language plpgsql security invoker set search_path = private, public as $$
declare
  v record;
  is_owner boolean := coalesce(is_super_admin(auth.uid()), false);
  writer uuid := private.lot_writer_yard();
  why text := nullif(btrim(_override_reason), '');
  spot record;
begin
  if not is_owner and writer is null then
    raise exception 'not allowed to move cars' using errcode = '42501';
  end if;
  if _via is null or _via not in ('scan', 'list', 'typed') then
    raise exception 'unknown way of choosing the place: %', _via;
  end if;
  if _location_id is null and nullif(btrim(concat_ws(' ', _zone, _slot)), '') is null then
    raise exception 'choose a slot or type a spot';
  end if;
  -- runs as the caller: row-level security decides which cars they can even see
  select id, yard_id, status into v from public.vehicle_visits where id = _visit_id;
  if not found then raise exception 'car not found' using errcode = '42501'; end if;
  if not is_owner and v.yard_id is distinct from writer then
    raise exception 'not allowed to move cars' using errcode = '42501';
  end if;
  if v.status = 'out' then raise exception 'a released car cannot be moved'; end if;
  if why is not null and not is_owner and v.yard_id is distinct from private.lot_admin_yard() then
    raise exception 'only the car lot''s admin or the owner can put a car in a full slot' using errcode = '42501';
  end if;

  perform set_config('car_lot.via', _via, true);
  perform set_config('car_lot.device', coalesce(left(btrim(_device), 40), ''), true);
  perform set_config('car_lot.reason', coalesce(why, ''), true);
  perform set_config('car_lot.override', case when why is not null then 'on' else '' end, true);
  if _location_id is not null then
    update public.vehicle_visits set location_id = _location_id where id = _visit_id;
  else
    update public.vehicle_visits
       set location_id = null, lot_zone = nullif(btrim(_zone), ''), lot_slot = nullif(btrim(_slot), '')
     where id = _visit_id;
  end if;
  perform set_config('car_lot.via', '', true);
  perform set_config('car_lot.device', '', true);
  perform set_config('car_lot.reason', '', true);
  perform set_config('car_lot.override', '', true);

  select lot_zone, lot_slot into spot from public.vehicle_visits where id = _visit_id;
  return concat_ws(' / ', spot.lot_zone, spot.lot_slot);
end $$;

-- ---------------------------------------------------------------------
-- 7. Editing a car: as before, but the place of a car in a listed slot is changed with Move
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
  select id, vehicle_id, status, yard_id, location_id into v from public.vehicle_visits where id = _visit_id;
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
  if v.location_id is not null and (_visit ? 'lot_zone' or _visit ? 'lot_slot') then
    raise exception 'this car is in a listed slot; use Move to change its place';
  end if;
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
-- 8. Who may call what
-- ---------------------------------------------------------------------
revoke all on function
  private.lot_slot_part(text, boolean), private.lot_slot_code(text, text, text), private.lot_spot_key(text),
  private.lot_slot_occupants(uuid, uuid), private.lot_locations_guard(), private.car_lot_setting(text),
  public.car_lot_move(uuid, uuid, text, text, text, text, text),
  public.car_lot_edit_car(uuid, jsonb, jsonb, text)
from public, anon, authenticated;
grant execute on function
  public.car_lot_move(uuid, uuid, text, text, text, text, text),
  public.car_lot_edit_car(uuid, jsonb, jsonb, text)
to authenticated, service_role;
