-- Tests for supabase/migrations/20261115000000_car_lot_retention.sql.
-- Run as a superuser on the car-lot test database (run-local.sh builds it), AFTER the
-- migration. Needs the retention token in :token (psql -v token=...). Rolled back at the end.
\set ON_ERROR_STOP 1
begin;
select id as lot from public.yards where code = 'evl-cars' \gset
create temp table res (n serial, name text, ok boolean, detail text);
create or replace function pg_temp.check(_name text, _ok boolean, _detail text default '') returns void language plpgsql as $$
begin insert into res (name, ok, detail) values (_name, coalesce(_ok, false), _detail); end $$;

-- fixtures: cars and visits released a given time ago, with inspections and photos
create or replace function pg_temp.old_visit(_vin text, _months int, _photos int, _hold_later boolean default false) returns uuid language plpgsql as $$
declare veh uuid := gen_random_uuid(); vis uuid := gen_random_uuid(); insp uuid := gen_random_uuid(); i int;
begin
  insert into public.vehicles (id, vin, manufacturer_id, yard_id) values (veh, _vin, 'aaaaaaaa-0000-0000-0000-00000000000a', (select id from public.yards where code='evl-cars'));
  insert into public.vehicle_visits (id, vehicle_id, created_by) values (vis, veh, '22222222-0000-0000-0000-000000000002');
  if _photos > 0 then
    insert into public.vehicle_inspections (id, visit_id, phase, inspector_id) values (insp, vis, 'gate_in', '22222222-0000-0000-0000-000000000002');
    for i in 1.._photos loop
      insert into public.vehicle_inspection_photos (inspection_id, angle, storage_path, taken_by)
      values (insp, 'front', 'aaaaaaaa-0000-0000-0000-00000000000a/' || veh || '/' || insp || '/' || _vin || '-' || i || '.jpg', '22222222-0000-0000-0000-000000000002');
    end loop;
    update public.vehicle_inspections set status = 'closed' where id = insp;
  end if;
  update public.vehicle_visits set status = 'out', gate_out_time = now() - make_interval(months => _months) where id = vis;
  if _hold_later then
    insert into public.vehicle_visits (vehicle_id, created_by, status) values (veh, '22222222-0000-0000-0000-000000000002', 'on-hold');
  end if;
  return vis;
end $$;

-- eligible (13 months, 2 photos)
select pg_temp.old_visit('RETAJNXELD0000001', 13, 2) as old13 \gset
-- under a year: kept
select pg_temp.old_visit('RETAJNXELD0000002', 11, 1) as young11 \gset
-- old, but the car is on hold now: kept
select pg_temp.old_visit('RETAJNXELD0000003', 14, 1, true) as heldcar \gset
-- eligible, no inspection
select pg_temp.old_visit('RETAJNXELD0000004', 15, 0) as old15 \gset
select count(*) as visits_before from public.vehicle_visits \gset
do $$ begin
  begin perform public.car_lot_retention_run('wrong', true); perform pg_temp.check('wrong token is refused', false);
  exception when insufficient_privilege then perform pg_temp.check('wrong token is refused', true); end;
  begin perform public.car_lot_retention_run(null, true); perform pg_temp.check('null token is refused', false);
  exception when insufficient_privilege then perform pg_temp.check('null token is refused', true); end;
  begin perform public.car_lot_retention_ack('wrong', array['x']); perform pg_temp.check('ack with a wrong token is refused', false);
  exception when insufficient_privilege then perform pg_temp.check('ack with a wrong token is refused', true); end;
end $$;

-- 2. waiting period: asking to delete still only reports
select public.car_lot_retention_run(:'token', false) as r1 \gset
select pg_temp.check('inside the 7-day wait, "delete" only reports', (:'r1'::jsonb->>'mode') = 'report' and (:'r1'::jsonb->>'deleted_visits') = '0', :'r1');
select pg_temp.check('the two eligible visits are the candidates', (:'r1'::jsonb->>'candidates') = '2');
select pg_temp.check('nothing was deleted', (select count(*) from public.vehicle_visits) = :visits_before);
select pg_temp.check('two report rows were logged', (select count(*) from public.retention_log where mode = 'report') = 2);
select public.car_lot_retention_run(:'token', true) as r1b \gset
select pg_temp.check('running again does not duplicate the report', (select count(*) from public.retention_log where mode = 'report') = 2);
select pg_temp.check('a visit under 12 months is not a candidate', not exists (select 1 from public.retention_log where visit_id = :'young11'));
select pg_temp.check('a car on hold is not a candidate', not exists (select 1 from public.retention_log where visit_id = :'heldcar'));
select pg_temp.check('the report counts the photos', (select photos from public.retention_log where visit_id = :'old13') = 2);

-- 3. the period cannot be lowered below a year
do $$ begin
  begin update private.retention_settings set months = 6; perform pg_temp.check('months cannot go below 12', false);
  exception when check_violation then perform pg_temp.check('months cannot go below 12', true); end;
end $$;

-- 4. after the wait: a dry run still reports; a real run deletes
update private.retention_settings set delete_not_before = now() - interval '1 day';
select public.car_lot_retention_run(:'token', true) as r2 \gset
select pg_temp.check('dry run after the wait still deletes nothing', (:'r2'::jsonb->>'mode') = 'report' and (select count(*) from public.vehicle_visits) = :visits_before);
select public.car_lot_retention_run(:'token', false) as r3 \gset
select pg_temp.check('a real run deletes the two visits', (:'r3'::jsonb->>'mode') = 'delete' and (:'r3'::jsonb->>'deleted_visits') = '2', :'r3');
select pg_temp.check('the old visits are gone', not exists (select 1 from public.vehicle_visits where id in (:'old13', :'old15')));
select pg_temp.check('their inspections and photo rows are gone', not exists (select 1 from public.vehicle_inspections where visit_id = :'old13'));
select pg_temp.check('the young visit and the held car are untouched', (select count(*) from public.vehicle_visits where id in (:'young11', :'heldcar')) = 2);
select pg_temp.check('the held car keeps its inspection and photos', (select count(*) from public.vehicle_inspection_photos p join public.vehicle_inspections i on i.id = p.inspection_id where i.visit_id = :'heldcar') = 1);
select pg_temp.check('the other fixtures are untouched', (select count(*) from public.vehicle_visits where id in ('ef000000-0000-0000-0000-0000000000a1','ef000000-0000-0000-0000-0000000000b1','ef000000-0000-0000-0000-0000000000a2')) = 3);
select pg_temp.check('the deletion is logged', (select count(*) from public.retention_log where mode = 'delete') = 2);
select pg_temp.check('the two photo files are queued for the Worker', jsonb_array_length(:'r3'::jsonb->'files') = 2, :'r3');
select pg_temp.check('the file keys are the deleted photos', (select bool_and(k like 'aaaaaaaa-0000-0000-0000-00000000000a/%RETAJNXELD0000001-%') from jsonb_array_elements_text(:'r3'::jsonb->'files') k));

-- 5. the guards that protect evidence are back on
do $$ begin
  begin delete from public.vehicle_inspection_photos; perform pg_temp.check('photo guard is back on', false);
  exception when others then perform pg_temp.check('photo guard is back on', sqlerrm like '%immutable%', sqlerrm); end;
  begin delete from public.vehicle_inspections; perform pg_temp.check('inspection guard is back on', false);
  exception when others then perform pg_temp.check('inspection guard is back on', sqlerrm like '%cannot be deleted%', sqlerrm); end;
end $$;

-- 6. files stay queued until the Worker confirms, then go
select public.car_lot_retention_run(:'token', false) as r4 \gset
select pg_temp.check('unconfirmed files are handed out again', jsonb_array_length(:'r4'::jsonb->'files') = 2);
select public.car_lot_retention_ack(:'token', array(select jsonb_array_elements_text(:'r4'::jsonb->'files'))) as acked \gset
select pg_temp.check('ack removes them', :acked = 2);
select pg_temp.check('then nothing is left to delete', jsonb_array_length(public.car_lot_retention_run(:'token', false)->'files') = 0);

-- 7. at most 50 visits per run
select count(pg_temp.old_visit('RETAJNBULK' || lpad(g::text, 7, '0'), 20, 0)) from generate_series(1, 55) g;
select pg_temp.check('a run takes at most 50 visits', (public.car_lot_retention_run(:'token', false)->>'deleted_visits') = '50');
select pg_temp.check('the next run takes the rest', (public.car_lot_retention_run(:'token', false)->>'deleted_visits') = '5');

-- 8. who can read the log. Each answer is captured under the role, then recorded as the superuser.
set local role authenticated;
select set_config('request.jwt.claim.sub', '11111111-0000-0000-0000-000000000001', true);
select count(*) as log_owner from public.retention_log \gset
select set_config('request.jwt.claim.sub', '22222222-0000-0000-0000-000000000001', true);
select count(*) as log_lotadmin from public.retention_log \gset
select set_config('request.jwt.claim.sub', '22222222-0000-0000-0000-000000000004', true);
select count(*) as log_mfr from public.retention_log \gset
do $$ declare helper text; wrongtoken text; begin
  begin perform private.retention_check_token('x'); helper := 'callable';
  exception when insufficient_privilege then helper := 'refused'; end;
  begin perform public.car_lot_retention_run('wrong', false); wrongtoken := 'allowed';
  exception when insufficient_privilege then wrongtoken := 'refused'; end;
  perform set_config('test.helper', helper, true); perform set_config('test.wrongtoken', wrongtoken, true);
end $$;
select current_setting('test.helper') as r_helper, current_setting('test.wrongtoken') as r_wrong \gset
reset role;
set local role anon;
do $$ declare t text; h text; begin
  begin perform public.car_lot_retention_run('wrong', false); t := 'allowed';
  exception when insufficient_privilege then t := 'refused'; end;
  begin perform count(*) from private.retention_settings; h := 'readable';
  exception when insufficient_privilege then h := 'refused'; end;
  perform set_config('test.anon_token', t, true); perform set_config('test.anon_hash', h, true);
end $$;
select current_setting('test.anon_token') as r_anon_token, current_setting('test.anon_hash') as r_anon_hash \gset
reset role;
select pg_temp.check('the owner can read the log', :log_owner > 0);
select pg_temp.check('a lot admin cannot read the log', :log_lotadmin = 0);
select pg_temp.check('a manufacturer cannot read the log', :log_mfr = 0);
select pg_temp.check('the private token helper is not callable by a signed-in user', :'r_helper' = 'refused');
select pg_temp.check('a signed-in user needs the token too', :'r_wrong' = 'refused');
select pg_temp.check('anon needs the token too', :'r_anon_token' = 'refused');
select pg_temp.check('anon cannot read the stored token hash', :'r_anon_hash' = 'refused');

select case when ok then 'PASS' else 'FAIL' end as result, name, case when ok then '' else detail end as detail from res order by n;
select count(*) filter (where ok) as pass, count(*) filter (where not ok) as fail from res;
rollback;
