-- Tests for supabase/migrations/20261121180000_car_lot_slots.sql: the slot list, a car's
-- slot, the full-slot rule, typed spots, moves in the history, and car_lot_edit_car()
-- leaving a slotted car's place to Move.
-- Run as a superuser on the car-lot test database AFTER the migration and carlot-seed.sql.
-- Every step runs as a real signed-in user. Rolled back at the end.
\set ON_ERROR_STOP 1
begin;
create temp table res (n serial, name text, ok boolean, detail text);
create function pg_temp.check(_name text, _ok boolean, _detail text default '') returns void language plpgsql as $$
begin insert into res (name, ok, detail) values (_name, coalesce(_ok, false), _detail); end $$;

-- Run one statement as a user (role authenticated + JWT sub). Returns 'ok' or 'error: <message>'.
-- The change STAYS, so steps can build on each other.
create function pg_temp.as_user(_uid text, _sql text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claim.sub', _uid, true);
  execute 'set local role authenticated';
  begin
    execute _sql;
    r := 'ok';
  exception when others then r := 'error: ' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  return r;
end $$;
-- The same, for a query returning one value.
create function pg_temp.as_user_val(_uid text, _sql text) returns text language plpgsql as $$
declare r text;
begin
  perform set_config('request.jwt.claim.sub', _uid, true);
  execute 'set local role authenticated';
  begin
    execute _sql into r;
  exception when others then r := 'error: ' || sqlerrm;
  end;
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', '', true);
  return r;
end $$;

\set owner   '11111111-0000-0000-0000-000000000001'
\set cyadmin '11111111-0000-0000-0000-000000000002'
\set admin   '22222222-0000-0000-0000-000000000001'
\set insp    '22222222-0000-0000-0000-000000000002'
\set office  '22222222-0000-0000-0000-000000000003'
\set mfa     '22222222-0000-0000-0000-000000000004'
\set ro      '22222222-0000-0000-0000-000000000006'
\set A1 'ef000000-0000-0000-0000-0000000000a1'
\set B1 'ef000000-0000-0000-0000-0000000000b1'
\set A2 'ef000000-0000-0000-0000-0000000000a2'
\set C1 'ef000000-0000-0000-0000-0000000000c1'
select id as lot from public.yards where code = 'evl-cars' \gset
select id as cy from public.yards where code = 'evl' \gset

-- A fourth car (manufacturer A), in the lot without a spot.
insert into public.vehicles (id, vin, manufacturer_id, yard_id) values
  ('ee000000-0000-0000-0000-0000000000c1', 'JTDKB20U093000005', 'aaaaaaaa-0000-0000-0000-00000000000a', :'lot');
insert into public.vehicle_visits (id, vehicle_id, created_by) values
  (:'C1', 'ee000000-0000-0000-0000-0000000000c1', :'insp');

-- ── the slot list: who may add, who may see ─────────────────────────
select pg_temp.as_user(:'admin', format($q$insert into public.lot_locations (yard_id, zone, row_label, slot) values (%L, ' a ', '1', '1')$q$, :'lot')) as r \gset
select pg_temp.check('the lot admin adds a slot', :'r' = 'ok', :'r');
select pg_temp.check('the slot name is normalised: " a " / 1 / 1 is A-01-01',
  exists (select 1 from public.lot_locations where code = 'A-01-01' and zone = 'A' and row_label = '01' and slot = '01' and created_by = :'admin'));
select id as s1 from public.lot_locations where code = 'A-01-01' \gset
select pg_temp.as_user(:'admin', format($q$insert into public.lot_locations (yard_id, zone, row_label, slot) values (%L, 'A', '1', '2')$q$, :'lot')) as r \gset
select pg_temp.check('a second slot', :'r' = 'ok', :'r');
select id as s2 from public.lot_locations where code = 'A-01-02' \gset
select pg_temp.as_user(:'admin', format($q$insert into public.lot_locations (yard_id, zone, kind, capacity) values (%L, 'receiving', 'receiving', 50)$q$, :'lot')) as r \gset
select pg_temp.check('a receiving area holding 50 cars', :'r' = 'ok' and exists (select 1 from public.lot_locations where code = 'RECEIVING' and capacity = 50), :'r');
select pg_temp.as_user(:'admin', format($q$insert into public.lot_locations (yard_id, zone, row_label, slot) values (%L, 'A', '01', '001')$q$, :'lot')) as r \gset
select pg_temp.check('the same slot cannot be added twice', :'r' like '%duplicate key%', :'r');
select pg_temp.as_user(:'admin', format($q$insert into public.lot_locations (yard_id, zone, slot) values (%L, 'A01', '1')$q$, :'lot')) as r \gset
select pg_temp.check('a slot that reads the same as another (A01-01 vs A-01-01) is refused', :'r' like '%duplicate key%', :'r');
select pg_temp.as_user(:'admin', format($q$insert into public.lot_locations (yard_id, zone) values (%L, 'A B')$q$, :'lot')) as r \gset
select pg_temp.check('a zone is letters and numbers only', :'r' like '%check constraint%', :'r');
select pg_temp.as_user(:'insp', format($q$insert into public.lot_locations (yard_id, zone) values (%L, 'Q')$q$, :'lot')) as r \gset
select pg_temp.check('an inspector cannot add slots', :'r' like '%row-level security%', :'r');
select pg_temp.as_user(:'office', format($q$insert into public.lot_locations (yard_id, zone) values (%L, 'Q')$q$, :'lot')) as r \gset
select pg_temp.check('the office cannot add slots', :'r' like '%row-level security%', :'r');
select pg_temp.as_user(:'ro', format($q$insert into public.lot_locations (yard_id, zone) values (%L, 'Q')$q$, :'lot')) as r \gset
select pg_temp.check('the read-only admin cannot add slots', :'r' like '%row-level security%', :'r');
select pg_temp.as_user(:'cyadmin', format($q$insert into public.lot_locations (yard_id, zone) values (%L, 'Q')$q$, :'lot')) as r \gset
select pg_temp.check('a container-yard admin cannot add slots to the car lot', :'r' like 'error:%', :'r');
select pg_temp.as_user(:'owner', format($q$insert into public.lot_locations (yard_id, zone) values (%L, 'Q')$q$, :'cy')) as r \gset
select pg_temp.check('slots only exist in a car-lot yard', :'r' like '%slots belong to a car-lot yard%', :'r');
select pg_temp.as_user(:'owner', format($q$insert into public.lot_locations (yard_id, zone, slot) values (%L, 'b', '1')$q$, :'lot')) as r \gset
select pg_temp.check('the owner adds a slot', :'r' = 'ok' and exists (select 1 from public.lot_locations where code = 'B-01'), :'r');
select id as sb from public.lot_locations where code = 'B-01' \gset

select pg_temp.as_user_val(:'insp', 'select count(*) from public.lot_locations') as r \gset
select pg_temp.check('the inspector sees the lot''s 4 slots', :'r' = '4', :'r');
select pg_temp.as_user_val(:'office', 'select count(*) from public.lot_locations') as r \gset
select pg_temp.check('the office sees them', :'r' = '4', :'r');
select pg_temp.as_user_val(:'ro', 'select count(*) from public.lot_locations') as r \gset
select pg_temp.check('the read-only admin sees them', :'r' = '4', :'r');
select pg_temp.as_user_val(:'mfa', 'select count(*) from public.lot_locations') as r \gset
select pg_temp.check('a manufacturer sees no slots', :'r' = '0', :'r');
select pg_temp.as_user_val(:'cyadmin', 'select count(*) from public.lot_locations') as r \gset
select pg_temp.check('a container-yard admin sees no slots', :'r' = '0', :'r');
select pg_temp.as_user_val(:'admin', 'with d as (delete from public.lot_locations returning 1) select count(*) from d') as r \gset
select pg_temp.check('nobody deletes a slot', :'r' = '0', :'r');

-- ── moving into a slot ──────────────────────────────────────────────
select pg_temp.as_user_val(:'insp', format('select public.car_lot_move(%L, %L, null, null, %L, %L)', :'A1', :'s1', 'scan', 'phone-7f3a')) as r \gset
select pg_temp.check('an inspector moves a car into a slot by scanning', :'r' = 'A / 01-01', :'r');
select pg_temp.check('the car has the slot, and its zone and slot text follow it',
  (select location_id = :'s1' and lot_zone = 'A' and lot_slot = '01-01' from public.vehicle_visits where id = :'A1'));
select pg_temp.check('the move is in the history: who, how, on which phone',
  exists (select 1 from public.vehicle_events where visit_id = :'A1' and action = 'move' and actor = :'insp'
            and via = 'scan' and device = 'phone-7f3a' and changes ? 'location_id'));
select pg_temp.as_user_val(:'office', format('select public.car_lot_move(%L, %L)', :'B1', :'s1')) as r \gset
select pg_temp.check('a full slot is refused, naming the car in it', :'r' like '%slot A-01-01 is full: it holds JTDKB20U093000001%', :'r');
select pg_temp.as_user_val(:'office', format('select public.car_lot_move(%L, %L, null, null, %L, null, %L)', :'B1', :'s1', 'list', 'Two small cars fit')) as r \gset
select pg_temp.check('the office cannot override a full slot', :'r' like '%only the car lot''s admin or the owner%', :'r');
select pg_temp.as_user_val(:'admin', format('select public.car_lot_move(%L, %L, null, null, %L, null, %L)', :'B1', :'s1', 'list', 'Two small cars fit')) as r \gset
select pg_temp.check('the lot admin can, with a reason', :'r' = 'A / 01-01', :'r');
select pg_temp.check('the override reason is in the history',
  exists (select 1 from public.vehicle_events where visit_id = :'B1' and action = 'move' and reason = 'Two small cars fit' and via = 'list'));
select pg_temp.as_user(:'insp', format('update public.vehicle_visits set location_id = %L where id = %L', :'s1', :'A2')) as r \gset
select pg_temp.check('a direct update can''t fill a full slot either', :'r' like '%is full%', :'r');
select pg_temp.as_user(:'insp', format($q$with s as (select set_config('car_lot.override', 'on', true) as x) update public.vehicle_visits set location_id = %L where id = %L and exists (select 1 from s)$q$, :'s1', :'A2')) as r \gset
select pg_temp.check('setting the override flag by hand does not let an inspector in', :'r' like '%is full%', :'r');

-- ── typed spots ─────────────────────────────────────────────────────
select pg_temp.as_user_val(:'office', format('select public.car_lot_move(%L, null, %L, %L, %L)', :'A2', 'a', '1 2', 'typed')) as r \gset
select pg_temp.check('a typed spot that is a listed slot counts as that slot ("a" "1 2" is A-01-02)',
  :'r' = 'A / 01-02' and (select location_id = :'s2' from public.vehicle_visits where id = :'A2'), :'r');
select pg_temp.check('a car on hold may be moved', (select status = 'on-hold' from public.vehicle_visits where id = :'A2'));
select pg_temp.as_user_val(:'office', format('select public.car_lot_move(%L, null, %L, %L, %L)', :'C1', 'A', '01-01', 'typed')) as r \gset
select pg_temp.check('typing a full slot''s code is refused like choosing it', :'r' like '%is full%', :'r');
select pg_temp.as_user_val(:'insp', format('select public.car_lot_move(%L, null, %L, %L, %L)', :'C1', 'X', '9', 'typed')) as r \gset
select pg_temp.check('a typed spot that is not a slot is kept as typed', :'r' = 'X / 9'
  and (select location_id is null and lot_zone = 'X' and lot_slot = '9' from public.vehicle_visits where id = :'C1'), :'r');
select pg_temp.check('the typed move is in the history', exists (select 1 from public.vehicle_events where visit_id = :'C1' and action = 'move' and via = 'typed'));
select pg_temp.as_user_val(:'office', format('select public.car_lot_move(%L, null, %L, %L, %L)', :'A2', 'Y', '1', 'typed')) as r \gset
select pg_temp.check('typing a spot takes the car out of its slot', :'r' = 'Y / 1' and (select location_id is null from public.vehicle_visits where id = :'A2'), :'r');

-- ── who may move, and what ─────────────────────────────────────────
select pg_temp.as_user_val(:'mfa', format('select public.car_lot_move(%L, %L)', :'C1', :'s2')) as r \gset
select pg_temp.check('a manufacturer cannot move cars', :'r' like '%not allowed to move cars%', :'r');
select pg_temp.as_user_val(:'ro', format('select public.car_lot_move(%L, %L)', :'C1', :'s2')) as r \gset
select pg_temp.check('the read-only admin cannot move cars', :'r' like '%not allowed to move cars%', :'r');
select pg_temp.as_user_val(:'cyadmin', format('select public.car_lot_move(%L, %L)', :'C1', :'s2')) as r \gset
select pg_temp.check('a container-yard admin cannot move cars', :'r' like '%not allowed to move cars%', :'r');
select pg_temp.as_user_val(:'insp', format('select public.car_lot_move(%L)', :'C1')) as r \gset
select pg_temp.check('a move needs a slot or a typed spot', :'r' like '%choose a slot or type a spot%', :'r');
select pg_temp.as_user_val(:'insp', format('select public.car_lot_move(%L, %L, null, null, %L)', :'C1', :'s2', 'teleport')) as r \gset
select pg_temp.check('only scan, list or typed', :'r' like '%unknown way%', :'r');

insert into public.yards (id, name, code, kind, created_by) values
  ('00000000-0000-0000-0000-0000000000e3', 'Second car lot', 'lot2', 'vehicle', :'owner');
insert into public.lot_locations (yard_id, zone, slot) values ('00000000-0000-0000-0000-0000000000e3', 'Q', '1');
select id as sq from public.lot_locations where code = 'Q-01' \gset
select pg_temp.as_user_val(:'insp', format('select public.car_lot_move(%L, %L)', :'C1', :'sq')) as r \gset
select pg_temp.check('a slot of another lot is refused', :'r' like '%belongs to another lot%', :'r');

select pg_temp.as_user(:'admin', format($q$insert into public.lot_locations (yard_id, zone, row_label, slot) values (%L, 'A', '2', '1')$q$, :'lot')) as r \gset
select id as s21 from public.lot_locations where code = 'A-02-01' \gset
select pg_temp.as_user(:'admin', format('update public.lot_locations set active = false where id = %L', :'s21')) as r \gset
select pg_temp.check('an empty slot can be taken out of use', :'r' = 'ok', :'r');
select pg_temp.as_user_val(:'insp', format('select public.car_lot_move(%L, %L)', :'C1', :'s21')) as r \gset
select pg_temp.check('a slot out of use is refused', :'r' like '%A-02-01 is not in use%', :'r');

-- ── a slot with cars in it ──────────────────────────────────────────
select pg_temp.as_user(:'admin', format('update public.lot_locations set active = false where id = %L', :'s1')) as r \gset
select pg_temp.check('a slot with cars in it stays in use', :'r' like '%move the cars out before taking it out of use%', :'r');
select pg_temp.as_user(:'admin', format($q$update public.lot_locations set zone = 'C' where id = %L$q$, :'s1')) as r \gset
select pg_temp.check('a slot with cars in it keeps its name', :'r' like '%move the cars out before renaming it%', :'r');
select pg_temp.as_user(:'admin', format('update public.lot_locations set capacity = 1 where id = %L', :'s1')) as r \gset
select pg_temp.check('a slot keeps room for the cars in it', :'r' like '%room cannot be less%', :'r');
select pg_temp.as_user(:'admin', format('update public.lot_locations set capacity = 3 where id = %L', :'s1')) as r \gset
select pg_temp.check('a slot can get more room', :'r' = 'ok', :'r');
select pg_temp.as_user_val(:'office', format('select public.car_lot_move(%L, %L)', :'C1', :'s1')) as r \gset
select pg_temp.check('with room, the next car fits', :'r' = 'A / 01-01', :'r');

-- ── released cars ───────────────────────────────────────────────────
select pg_temp.as_user(:'office', format($q$update public.vehicle_visits set status = 'out', gate_out_driver_name = 'SAMI' where id = %L$q$, :'A1')) as r \gset
select pg_temp.check('a car in a slot is gated out as before', :'r' = 'ok', :'r');
select pg_temp.check('the gate-out is still recorded as a gate-out', exists (select 1 from public.vehicle_events where visit_id = :'A1' and action = 'gate_out'));
select pg_temp.check('a released car no longer takes room', (select n from private.lot_slot_occupants(:'s1', null)) = 2);
select pg_temp.as_user_val(:'admin', format('select public.car_lot_move(%L, %L)', :'A1', :'s2')) as r \gset
select pg_temp.check('a released car cannot be moved', :'r' like '%released car cannot be moved%', :'r');
select pg_temp.as_user(:'admin', format($q$update public.vehicle_visits set lot_zone = 'Z' where id = %L$q$, :'A1')) as r \gset
select pg_temp.check('nor its spot changed directly', :'r' like '%released car cannot be moved%', :'r');

-- ── editing ─────────────────────────────────────────────────────────
select pg_temp.as_user(:'admin', format($q$select public.car_lot_edit_car(%L, '{}', '{"lot_zone":"Z"}', null)$q$, :'B1')) as r \gset
select pg_temp.check('a slotted car''s place is not edited, it is moved', :'r' like '%use Move%', :'r');
select pg_temp.as_user(:'admin', format($q$select public.car_lot_edit_car(%L, '{}', '{"free_days":10}', null)$q$, :'B1')) as r \gset
select pg_temp.check('its other details still are', :'r' = 'ok' and (select free_days from public.vehicle_visits where id = :'B1') = 10, :'r');
select pg_temp.as_user(:'admin', format($q$select public.car_lot_edit_car(%L, '{}', '{"lot_zone":"b","lot_slot":"1"}', null)$q$, :'A2')) as r \gset
select pg_temp.check('editing a typed spot to a slot''s code puts the car in that slot',
  :'r' = 'ok' and (select location_id = :'sb' from public.vehicle_visits where id = :'A2'), :'r');

-- ── the other history rules still hold ──────────────────────────────
select pg_temp.as_user(:'office', format($q$update public.vehicle_visits set status = 'on-hold', hold_reason = 'Customs' where id = %L$q$, :'B1')) as r \gset
select pg_temp.check('a hold is still a hold, not a move', :'r' = 'ok' and exists (select 1 from public.vehicle_events where visit_id = :'B1' and action = 'hold'), :'r');
select pg_temp.check('nothing else records via or device', not exists (select 1 from public.vehicle_events where action <> 'move' and (via is not null or device is not null)));

-- ── helpers and the spot rule ───────────────────────────────────────
select pg_temp.as_user(:'insp', $q$select private.lot_spot_key('a')$q$) as r \gset
select pg_temp.check('the helper functions are not callable by users', :'r' like 'error:%', :'r');
select pg_temp.check('the typed-spot rule (same vectors as src/lib/__tests__/lotSlots.test.ts)',
  private.lot_spot_key('b 3 7') = 'B-03-07' and private.lot_spot_key('B3-7') = 'B-03-07' and private.lot_spot_key('b-03-07') = 'B-03-07'
  and private.lot_spot_key('Z10') = 'Z-10' and private.lot_spot_key('receiving') = 'RECEIVING' and private.lot_spot_key('007') = '07'
  and private.lot_spot_key('0') = '00' and private.lot_spot_key('A/12.3') = 'A-12-03' and private.lot_spot_key('  ') is null);

-- ── server jobs are not held to the full-slot rule ──────────────────
update public.vehicle_visits set location_id = :'s2' where id = :'C1';
update public.vehicle_visits set location_id = :'s2' where id = :'B1';
select pg_temp.check('a server job (auth.uid() is null) may fill a slot past its room', (select n from private.lot_slot_occupants(:'s2', null)) = 2);

select case when ok then 'PASS' else 'FAIL' end as result, name, case when ok then '' else detail end as detail from res order by n;
select count(*) filter (where ok) as pass, count(*) filter (where not ok) as fail from res;
rollback;
