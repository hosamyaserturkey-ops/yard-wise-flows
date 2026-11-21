-- ROLLBACK of supabase/migrations/20261121180000_car_lot_slots.sql
-- Puts the car lot back exactly as 20261121000000 left it: no slot list, no
-- location_id, no 'move' history, and the guard, history trigger and
-- car_lot_edit_car() as they were. Refuses to run once a car has been placed in
-- a listed slot or moved, so no history is lost. An unused slot list IS dropped
-- (re-adding slots later is a few clicks).
begin;

do $check$
begin
  if exists (select 1 from public.vehicle_visits where location_id is not null)
     or exists (select 1 from public.vehicle_events where action = 'move' or via is not null or device is not null) then
    raise exception 'cars have been placed in listed slots or moved: rolling back would lose history';
  end if;
end $check$;

drop function if exists public.car_lot_move(uuid, uuid, text, text, text, text, text);

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

alter table public.vehicle_visits drop column if exists location_id;
drop table if exists public.lot_locations;
alter table public.vehicle_events drop column if exists via, drop column if exists device;
alter table public.vehicle_events drop constraint vehicle_events_action_check;
alter table public.vehicle_events add constraint vehicle_events_action_check
  check (action in ('gate_in', 'edit', 'hold', 'release_hold', 'gate_out'));
drop function if exists private.lot_locations_guard();
drop function if exists private.lot_slot_occupants(uuid, uuid);
drop function if exists private.lot_spot_key(text);
drop function if exists private.lot_slot_code(text, text, text);
drop function if exists private.lot_slot_part(text, boolean);
drop function if exists private.lot_two_digits(text);
drop function if exists private.car_lot_setting(text);

revoke all on function public.car_lot_edit_car(uuid, jsonb, jsonb, text) from public, anon, authenticated;
grant execute on function public.car_lot_edit_car(uuid, jsonb, jsonb, text) to authenticated, service_role;

commit;
