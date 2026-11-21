-- Tests for supabase/migrations/20261121000000_car_lot_history_hold_gateout.sql: hold reason,
-- the change history, car_lot_edit_car(), and no gate-out without a closed departure inspection.
-- Run as a superuser on the car-lot test database (run-local.sh builds it) AFTER the migration.
-- Every step runs as a real signed-in user. Rolled back at the end.
\set ON_ERROR_STOP 1
begin;
create temp table res (n serial, name text, ok boolean, detail text);
create function pg_temp.check(_name text, _ok boolean, _detail text default '') returns void language plpgsql as $$
begin insert into res (name, ok, detail) values (_name, coalesce(_ok, false), _detail); end $$;

-- Run one statement as a user (role authenticated + JWT sub). Returns 'ok' or 'error: <message>'.
-- Unlike the matrix, the change STAYS, so steps can build on each other.
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
\set office  '22222222-0000-0000-0000-000000000003'
\set mfa     '22222222-0000-0000-0000-000000000004'
\set ro      '22222222-0000-0000-0000-000000000006'
\set A1 'ef000000-0000-0000-0000-0000000000a1'
\set B1 'ef000000-0000-0000-0000-0000000000b1'
\set VB1 'ee000000-0000-0000-0000-0000000000b1'

-- ── hold ─────────────────────────────────────────────────────────────
select pg_temp.as_user(:'office', $$update public.vehicle_visits set status='on-hold' where id='ef000000-0000-0000-0000-0000000000b1'$$) as r \gset
select pg_temp.check('a hold needs a reason', :'r' like '%reason is required to put a car on hold%', :'r');
select pg_temp.as_user(:'office', $$update public.vehicle_visits set status='on-hold', hold_reason='  ' where id='ef000000-0000-0000-0000-0000000000b1'$$) as r \gset
select pg_temp.check('a blank reason is not a reason', :'r' like '%reason is required%', :'r');
select pg_temp.as_user(:'office', $$update public.vehicle_visits set status='on-hold', hold_reason=' Damage dispute: rear bumper ' where id='ef000000-0000-0000-0000-0000000000b1'$$) as r \gset
select pg_temp.check('with a reason the car goes on hold', :'r' = 'ok', :'r');
select pg_temp.check('the reason, who and when are recorded',
  (select hold_reason = 'Damage dispute: rear bumper' and held_by = :'office' and held_at is not null from public.vehicle_visits where id = :'B1'));
select pg_temp.check('the hold is in the history, with the reason and the person',
  exists (select 1 from public.vehicle_events where visit_id = :'B1' and action = 'hold' and reason = 'Damage dispute: rear bumper' and actor = :'office' and actor_name = 'lot_office'));
select pg_temp.as_user(:'office', $$update public.vehicle_visits set hold_reason='changed my mind' where id='ef000000-0000-0000-0000-0000000000b1'$$) as r \gset
select pg_temp.check('the reason cannot be rewritten while on hold', (select hold_reason from public.vehicle_visits where id = :'B1') = 'Damage dispute: rear bumper');
select pg_temp.as_user(:'office', $$update public.vehicle_visits set status='out' where id='ef000000-0000-0000-0000-0000000000b1'$$) as r \gset
select pg_temp.check('a car on hold still cannot be gated out', :'r' like '%on hold%', :'r');
select pg_temp.as_user(:'office', $$update public.vehicle_visits set status='in-lot' where id='ef000000-0000-0000-0000-0000000000b1'$$) as r \gset
select pg_temp.check('the hold can be released', :'r' = 'ok', :'r');
select pg_temp.check('releasing clears the hold fields', (select hold_reason is null and held_at is null and held_by is null from public.vehicle_visits where id = :'B1'));
select pg_temp.check('the release is in the history', exists (select 1 from public.vehicle_events where visit_id = :'B1' and action = 'release_hold'));

-- ── gate-out needs a closed departure inspection ─────────────────────
select pg_temp.as_user(:'office', $$update public.vehicle_visits set status='out' where id='ef000000-0000-0000-0000-0000000000b1'$$) as r \gset
select pg_temp.check('no gate-out without a closed departure inspection', :'r' like '%close the departure inspection%', :'r');
select pg_temp.as_user(:'office', $$insert into public.vehicle_inspections (visit_id, phase) values ('ef000000-0000-0000-0000-0000000000b1', 'gate_out')$$) as r \gset
select pg_temp.as_user(:'office', $$update public.vehicle_visits set status='out' where id='ef000000-0000-0000-0000-0000000000b1'$$) as r \gset
select pg_temp.check('an OPEN departure inspection is not enough', :'r' like '%close the departure inspection%', :'r');
select pg_temp.as_user(:'office', $$update public.vehicle_visits set status='out', gate_out_driver_name='Khaled' where id='ef000000-0000-0000-0000-0000000000a1'$$) as r \gset
select pg_temp.check('with a closed departure inspection the car can leave', :'r' = 'ok', :'r');
select pg_temp.check('the gate-out is in the history with the driver',
  exists (select 1 from public.vehicle_events where visit_id = :'A1' and action = 'gate_out' and changes ? 'status' and changes -> 'gate_out_driver_name' ->> 1 = 'Khaled'));

-- ── editing through car_lot_edit_car() ───────────────────────────────
select pg_temp.as_user(:'admin', $$select public.car_lot_edit_car('ef000000-0000-0000-0000-0000000000b1', '{"model":"Elantra N","color":"Blue"}', '{"lot_slot":"9"}', null)$$) as r \gset
select pg_temp.check('the lot admin can edit a car in the lot', :'r' = 'ok', :'r');
select pg_temp.check('the car and the visit both changed',
  (select v.model = 'Elantra N' and v.color = 'Blue' and vv.lot_slot = '9' from public.vehicles v join public.vehicle_visits vv on vv.vehicle_id = v.id where vv.id = :'B1'));
select pg_temp.check('the edit is in the history with old and new values',
  exists (select 1 from public.vehicle_events where visit_id = :'B1' and action = 'edit' and changes -> 'model' = '["Model B", "Elantra N"]'::jsonb)
  and exists (select 1 from public.vehicle_events where visit_id = :'B1' and action = 'edit' and changes -> 'lot_slot' ->> 1 = '9' and actor = :'admin'));
select pg_temp.as_user(:'admin', $$select public.car_lot_edit_car('ef000000-0000-0000-0000-0000000000b1', '{"vin":"KMHCT41DAEU000009","color":"Green"}', '{}', null)$$) as r \gset
select pg_temp.check('a VIN change needs a reason', :'r' like '%reason is required to change a VIN%', :'r');
select pg_temp.check('...and nothing of that edit was saved', (select vin = 'KMHCT41DAEU000001' and color = 'Blue' from public.vehicles where id = :'VB1'));
select pg_temp.as_user(:'admin', $$select public.car_lot_edit_car('ef000000-0000-0000-0000-0000000000b1', '{"vin":"kmhct41daeu000009"}', '{}', 'Typo at gate: 1 read as 9')$$) as r \gset
select pg_temp.check('with a reason the VIN is corrected (upper case)', :'r' = 'ok' and (select vin from public.vehicles where id = :'VB1') = 'KMHCT41DAEU000009', :'r');
select pg_temp.check('the VIN change is in the history with the reason',
  exists (select 1 from public.vehicle_events where vehicle_id = :'VB1' and changes -> 'vin' = '["KMHCT41DAEU000001", "KMHCT41DAEU000009"]'::jsonb and reason = 'Typo at gate: 1 read as 9'));
select pg_temp.as_user(:'office', $$select public.car_lot_edit_car('ef000000-0000-0000-0000-0000000000b1', '{"color":"Red"}', '{}', null)$$) as r \gset
select pg_temp.check('an office user cannot use the edit', :'r' like '%only the car lot''s admin or the owner%', :'r');
select pg_temp.as_user(:'cyadmin', $$select public.car_lot_edit_car('ef000000-0000-0000-0000-0000000000b1', '{"color":"Red"}', '{}', null)$$) as r \gset
select pg_temp.check('a container-yard admin cannot use it', :'r' like 'error:%', :'r');
select pg_temp.as_user(:'admin', $$select public.car_lot_edit_car('ef000000-0000-0000-0000-0000000000a1', '{"color":"Red"}', '{}', null)$$) as r \gset
select pg_temp.check('a released car cannot be edited', :'r' like '%released car cannot be edited%', :'r');
select pg_temp.as_user(:'admin', $$select public.car_lot_edit_car('ef000000-0000-0000-0000-0000000000b1', '{"manufacturer_id":"bbbbbbbb-0000-0000-0000-00000000000b"}', '{}', null)$$) as r \gset
select pg_temp.check('only the listed fields can be edited', :'r' like '%cannot edit manufacturer_id%', :'r');
select pg_temp.as_user(:'admin', $$select public.car_lot_edit_car('ef000000-0000-0000-0000-0000000000b1', '{}', '{"status":"out"}', null)$$) as r \gset
select pg_temp.check('the edit cannot release a car', :'r' like '%cannot edit status%', :'r');
select pg_temp.as_user(:'admin', $$select public.car_lot_edit_car('ef000000-0000-0000-0000-0000000000b1', '{}', '{"free_days":400}', null)$$) as r \gset
select pg_temp.check('free days stay between 0 and 365', :'r' like '%free days%', :'r');
select pg_temp.as_user(:'owner', $$select public.car_lot_edit_car('ef000000-0000-0000-0000-0000000000b1', '{}', '{"free_days":10}', 'Agreed with manufacturer')$$) as r \gset
select pg_temp.check('the owner can edit', :'r' = 'ok' and (select free_days from public.vehicle_visits where id = :'B1') = 10, :'r');

-- ── direct changes (not through the edit) are recorded too ───────────
select pg_temp.as_user(:'office', $$update public.vehicles set vin='KMHCT41DAEU000008' where id='ee000000-0000-0000-0000-0000000000b1'$$) as r \gset
select pg_temp.check('a VIN cannot be changed directly without a reason', :'r' like '%reason is required to change a VIN%', :'r');
select pg_temp.as_user(:'office', $$update public.vehicles set color='Grey' where id='ee000000-0000-0000-0000-0000000000b1'$$) as r \gset
select pg_temp.check('a direct change of colour is recorded with who did it',
  :'r' = 'ok' and exists (select 1 from public.vehicle_events where vehicle_id = :'VB1' and actor = :'office' and changes -> 'color' ->> 1 = 'Grey'), :'r');
select pg_temp.as_user(:'office', $$with v as (insert into public.vehicles (vin, manufacturer_id, yard_id) values ('JTDKB20U093000077','aaaaaaaa-0000-0000-0000-00000000000a',(select id from public.yards where code='evl-cars')) returning id) insert into public.vehicle_visits (vehicle_id, created_by) select id, auth.uid() from v$$) as r \gset
select pg_temp.check('registering a car records the gate-in',
  :'r' = 'ok' and exists (select 1 from public.vehicle_events e join public.vehicles v on v.id = e.vehicle_id where v.vin = 'JTDKB20U093000077' and e.action = 'gate_in' and e.actor = :'office'), :'r');

-- ── who can read the history; nobody can write it ────────────────────
select pg_temp.as_user_val(:'office', 'select count(*) from public.vehicle_events') as n_office \gset
select pg_temp.as_user_val(:'ro', 'select count(*) from public.vehicle_events') as n_ro \gset
select pg_temp.as_user_val(:'owner', 'select count(*) from public.vehicle_events') as n_owner \gset
select pg_temp.as_user_val(:'mfa', 'select count(*) from public.vehicle_events') as n_mfa \gset
select pg_temp.as_user_val(:'cyadmin', 'select count(*) from public.vehicle_events') as n_cy \gset
select count(*) as n_all from public.vehicle_events \gset
select pg_temp.check('the lot staff see the whole history', :'n_office' = :'n_all', :'n_office' || ' of ' || :'n_all');
select pg_temp.check('the read-only admin sees it', :'n_ro' = :'n_all');
select pg_temp.check('the owner sees it', :'n_owner' = :'n_all');
select pg_temp.check('a manufacturer does not', :'n_mfa' = '0', :'n_mfa');
select pg_temp.check('a container-yard admin does not', :'n_cy' = '0', :'n_cy');
select pg_temp.as_user(:'admin', $$insert into public.vehicle_events (vehicle_id, yard_id, manufacturer_id, action) select vehicle_id, yard_id, manufacturer_id, 'edit' from public.vehicle_visits limit 1$$) as r \gset
select pg_temp.check('nobody can add a history row', :'r' like 'error:%', :'r');
select pg_temp.as_user_val(:'admin', $$with u as (update public.vehicle_events set reason='x' returning 1) select count(*) from u$$) as r \gset
select pg_temp.check('nobody can change a history row', :'r' = '0', :'r');
select pg_temp.as_user_val(:'admin', $$with d as (delete from public.vehicle_events returning 1) select count(*) from d$$) as r \gset
select pg_temp.check('nobody can delete a history row', :'r' = '0', :'r');
select pg_temp.as_user(:'office', $$select private.jsonb_changes('{}','{}','{}')$$) as r \gset
select pg_temp.check('the helper functions are not callable by users', :'r' like 'error:%', :'r');

-- ── server jobs are not held to the new rules ────────────────────────
update public.vehicle_visits set status = 'on-hold' where id = 'ef000000-0000-0000-0000-0000000000a2';
select pg_temp.check('a server job may still update without a reason (auth.uid() is null)', true);

select case when ok then 'PASS' else 'FAIL' end as result, name, case when ok then '' else detail end as detail from res order by n;
select count(*) filter (where ok) as pass, count(*) filter (where not ok) as fail from res;
rollback;
