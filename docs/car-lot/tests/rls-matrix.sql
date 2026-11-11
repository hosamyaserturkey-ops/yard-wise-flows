-- Car-lot RLS / storage test matrix (plan section 6), run as postgres after
-- carlot_seed.sql. Each check runs as a real signed-in user (role
-- authenticated + JWT sub) or as anon, inside its own subtransaction that is
-- always rolled back, so checks never affect each other.
--   psql -v photos=<photo table name>
-- expected: exact text | 'blocked' (no rows touched, or an error) | 'error' | 'not:<value>'
\set ON_ERROR_STOP 1
\pset footer off
create temp table actors (actor text primary key, uid uuid);
insert into actors values
 ('owner',      '11111111-0000-0000-0000-000000000001'), ('cy_admin', '11111111-0000-0000-0000-000000000002'),
 ('cy_insp',    '11111111-0000-0000-0000-000000000003'), ('cy_user',  '11111111-0000-0000-0000-000000000004'),
 ('lot_admin',  '22222222-0000-0000-0000-000000000001'), ('lot_insp', '22222222-0000-0000-0000-000000000002'),
 ('lot_office', '22222222-0000-0000-0000-000000000003'), ('mfa_rep',  '22222222-0000-0000-0000-000000000004'),
 ('mfb_rep',    '22222222-0000-0000-0000-000000000005'), ('ro_admin', '22222222-0000-0000-0000-000000000006'), ('anon', null);

create temp table tests (n serial, actor text, label text, kind text, stmt text, expected text, observed text, detail text);
-- shorthand used in statements: {A} {B} = manufacturer ids, {VA1} {VB1} vehicles, {IA1} open / {IB1} closed inspection,
-- {pA} {pB} = photo folders of inspection A1 / B1, {LOT} {EVL} = yard ids, {photos} = photo table
insert into tests (actor, label, kind, stmt, expected) values
-- ── Manufacturer A rep ─────────────────────────────────────────────────
 ('mfa_rep','sees only A vehicles (total:A)',            'read',  $$select count(*)||':'||count(*) filter (where manufacturer_id='{A}') from public.vehicles$$, '2:2'),
 ('mfa_rep','sees only A visits',                        'read',  $$select count(*)||':'||count(*) filter (where manufacturer_id='{A}') from public.vehicle_visits$$, '2:2'),
 ('mfa_rep','sees only A inspections',                   'read',  $$select count(*)||':'||count(*) filter (where manufacturer_id='{A}') from public.vehicle_inspections$$, '1:1'),
 ('mfa_rep','sees only A photo rows',                    'read',  $$select count(*)||':'||count(*) filter (where manufacturer_id='{A}') from public.{photos}$$, '1:1'),
 ('mfa_rep','sees only own manufacturer row',            'read',  $$select string_agg(code, ',') from public.manufacturers$$, 'MFA'),
 ('mfa_rep','B vehicle by id',                           'read',  $$select count(*) from public.vehicles where id='{VB1}'$$, '0'),
 ('mfa_rep','view own car photo (Worker gets the row)',   'read',  $$select count(*) from public.{photos} where storage_path='{pA}front.jpg'$$, '1'),
 ('mfa_rep','view B car photo (Worker gets no row)',      'read',  $$select count(*) from public.{photos} where storage_path='{pB}front.jpg'$$, '0'),
 ('mfa_rep','insert vehicle',                            'write', $$insert into public.vehicles (vin, manufacturer_id, yard_id) values ('JTDKB20U093000009','{A}','{LOT}')$$, 'error'),
 ('mfa_rep','update own visit',                          'write', $$update public.vehicle_visits set lot_zone='X' where manufacturer_id='{A}'$$, 'blocked'),
 ('mfa_rep','delete own vehicle',                        'write', $$delete from public.vehicles where id='{VA1}'$$, 'blocked'),
 ('mfa_rep','get photo upload key',                       'read',  $$select public.vehicle_photo_upload_prefix('{IA1}')$$, 'error'),
 ('mfa_rep','read containers',                           'read',  $$select count(*) from public.containers$$, '0'),
 ('mfa_rep','read container_visits',                     'read',  $$select count(*) from public.container_visits$$, '0'),
 ('mfa_rep','read bookings',                             'read',  $$select count(*) from public.bookings$$, '0'),
 ('mfa_rep','read activity_log',                         'read',  $$select count(*) from public.activity_log$$, '0'),
 ('mfa_rep','read inspector_checks',                     'read',  $$select count(*) from public.inspector_checks$$, '0'),
 ('mfa_rep','read demurrage_payments',                   'read',  $$select count(*) from public.demurrage_payments$$, '0'),
 ('mfa_rep','read profiles (own only)',                  'read',  $$select count(*) from public.profiles$$, '1'),
 ('mfa_rep','read yards',                                'read',  $$select count(*) from public.yards$$, '0'),
 ('mfa_rep','read container photo + receipt buckets',    'read',  $$select count(*) from storage.objects where bucket_id in ('inspection-photos','transfer-receipts')$$, '0'),
 ('mfa_rep','read shipping lines (their tariffs)',       'read',  $$select count(*) from public.shipping_lines$$, '0'),
 ('mfa_rep','switch own profile to manufacturer B',      'write', $$update public.profiles set manufacturer_id='{B}' where user_id=auth.uid()$$, 'blocked'),
 ('mfa_rep','switch to B + set role user',               'write', $$update public.profiles set manufacturer_id='{B}', role='user' where user_id=auth.uid()$$, 'blocked'),
 ('mfa_rep','attach self to container yard',             'write', $$update public.profiles set manufacturer_id=null, yard_id='{EVL}' where user_id=auth.uid()$$, 'blocked'),
-- ── Car-lot inspector ──────────────────────────────────────────────────
 ('lot_insp','create vehicle',                           'write', $$insert into public.vehicles (vin, manufacturer_id, yard_id) values ('JTDKB20U093000002','{A}','{LOT}')$$, 'ok:1'),
 ('lot_insp','VIN with letter I rejected',               'write', $$insert into public.vehicles (vin, manufacturer_id, yard_id) values ('JTDKB20U09300000I','{A}','{LOT}')$$, 'error'),
 ('lot_insp','duplicate VIN rejected',                   'write', $$insert into public.vehicles (vin, manufacturer_id, yard_id) values ('JTDKB20U093000001','{A}','{LOT}')$$, 'error'),
 ('lot_insp','second open visit rejected',               'write', $$insert into public.vehicle_visits (vehicle_id, created_by) values ('{VA1}', auth.uid())$$, 'error'),
 ('lot_insp','get upload key, OPEN inspection',           'read',  $$select public.vehicle_photo_upload_prefix('{IA1}')$$, 'aaaaaaaa-0000-0000-0000-00000000000a/ee000000-0000-0000-0000-0000000000a1/f1000000-0000-0000-0000-0000000000a1/'),
 ('lot_insp','photo row for open inspection',            'write', $$insert into public.{photos} (inspection_id, angle, storage_path) values ('{IA1}','rear','{pA}new2.jpg')$$, 'ok:1'),
 ('lot_insp','get upload key, CLOSED inspection',         'read',  $$select public.vehicle_photo_upload_prefix('{IB1}')$$, 'error'),
 ('lot_insp','photo row for CLOSED inspection',          'write', $$insert into public.{photos} (inspection_id, angle, storage_path) values ('{IB1}','rear','{pB}late.jpg')$$, 'error'),
 ('lot_insp','get upload key, unknown inspection',        'read',  $$select public.vehicle_photo_upload_prefix(gen_random_uuid())$$, 'error'),
 ('lot_insp','photo row path of another inspection',     'write', $$insert into public.{photos} (inspection_id, angle, storage_path) values ('{IA1}','rear','{pB}x.jpg')$$, 'error'),
 ('lot_insp','edit a photo row',                         'write', $$update public.{photos} set note='x'$$, 'blocked'),
 ('lot_insp','delete a photo row',                       'write', $$delete from public.{photos}$$, 'blocked'),
 ('lot_insp','edit CLOSED inspection',                   'write', $$update public.vehicle_inspections set notes='x' where id='{IB1}'$$, 'blocked'),
 ('lot_insp','edit OPEN inspection',                     'write', $$update public.vehicle_inspections set notes='x' where id='{IA1}'$$, 'ok:1'),
 ('lot_insp','move visit to manufacturer B',             'read',  $$with u as (update public.vehicle_visits set manufacturer_id='{B}' where id='ef000000-0000-0000-0000-0000000000a1' returning manufacturer_id) select coalesce((select manufacturer_id::text from u),'none')$$, 'not:{B}'),
 ('lot_insp','move vehicle (with history) to B',         'read',  $$with u as (update public.vehicles set manufacturer_id='{B}' where id='{VA1}' returning manufacturer_id) select coalesce((select manufacturer_id::text from u),'none')$$, 'not:{B}'),
 ('lot_insp','gate out a car that is ON HOLD',           'write', $$update public.vehicle_visits set status='out', gate_out_time=now(), gated_out_by=auth.uid() where id='ef000000-0000-0000-0000-0000000000a2'$$, 'blocked'),
 ('lot_insp','gate-out records who released the car',    'read',  $$with u as (update public.vehicle_visits set status='out' where id='ef000000-0000-0000-0000-0000000000a1' returning gated_out_by, gate_out_time) select (select gated_out_by::text || ':' || (gate_out_time is not null)::text from u)$$, '22222222-0000-0000-0000-000000000002:true'),
 ('lot_insp','vehicle in container yard',                'write', $$insert into public.vehicles (vin, manufacturer_id, yard_id) values ('JTDKB20U093000004','{A}','{EVL}')$$, 'error'),
 ('lot_insp','create manufacturer',                      'write', $$insert into public.manufacturers (yard_id, code, name) values ('{LOT}','X','X')$$, 'error'),
 ('lot_insp','read containers',                          'read',  $$select count(*) from public.containers$$, '0'),
 ('lot_insp','read container_visits',                    'read',  $$select count(*) from public.container_visits$$, '0'),
 ('lot_insp','read inspector_checks',                    'read',  $$select count(*) from public.inspector_checks$$, '0'),
 ('lot_insp','read container photos + receipts',         'read',  $$select count(*) from storage.objects where bucket_id in ('inspection-photos','transfer-receipts')$$, '0'),
 ('lot_insp','upload to container photo bucket',         'write', $$insert into storage.objects (bucket_id, name) values ('inspection-photos','MSCU0000003/x.jpg')$$, 'error'),
 ('lot_insp','APPROVE a container (container yard)',     'write', $$insert into public.inspector_checks (container_number, grade, status, inspector_id, yard_id) values ('MSCU0000003','A','approved',auth.uid(),'{EVL}')$$, 'error'),
 ('lot_insp','approve a container (car-lot yard)',       'write', $$insert into public.inspector_checks (container_number, grade, status, inspector_id, yard_id) values ('MSCU0000003','A','approved',auth.uid(),'{LOT}')$$, 'error'),
-- ── Car-lot office user ────────────────────────────────────────────────
 ('lot_office','read lot vehicles',                      'read',  $$select count(*) from public.vehicles$$, '3'),
 ('lot_office','read lot photo rows',                    'read',  $$select count(*) from public.{photos}$$, '2'),
 ('lot_office','create vehicle',                         'write', $$insert into public.vehicles (vin, manufacturer_id, yard_id) values ('JTDKB20U093000005','{A}','{LOT}')$$, 'ok:1'),
 ('lot_office','open a visit (register car in)',         'write', $$with v as (insert into public.vehicles (vin, manufacturer_id, yard_id) values ('JTDKB20U093000012','{A}','{LOT}') returning id) insert into public.vehicle_visits (vehicle_id, created_by) select id, auth.uid() from v$$, 'ok:1'),
 ('lot_office','edit a visit',                           'write', $$update public.vehicle_visits set lot_zone='Z'$$, 'ok:3'),
 ('lot_office','gate out a car (decision 3)',          'read',  $$with u as (update public.vehicle_visits set status='out' where id='ef000000-0000-0000-0000-0000000000a1' returning gated_out_by, gate_out_time) select (select gated_out_by::text || ':' || (gate_out_time is not null)::text from u)$$, '22222222-0000-0000-0000-000000000003:true'),
 ('lot_office','gate out a car that is ON HOLD',         'write', $$update public.vehicle_visits set status='out' where id='ef000000-0000-0000-0000-0000000000a2'$$, 'blocked'),
 ('lot_office','get photo upload key',                    'read',  $$select public.vehicle_photo_upload_prefix('{IA1}')$$, 'aaaaaaaa-0000-0000-0000-00000000000a/ee000000-0000-0000-0000-0000000000a1/f1000000-0000-0000-0000-0000000000a1/'),
 ('lot_office','create manufacturer',                    'write', $$insert into public.manufacturers (yard_id, code, name) values ('{LOT}','MFD','D')$$, 'error'),
 ('lot_office','vehicle in container yard',              'write', $$insert into public.vehicles (vin, manufacturer_id, yard_id) values ('JTDKB20U093000010','{A}','{EVL}')$$, 'error'),
 ('lot_office','read containers',                        'read',  $$select count(*) from public.containers$$, '0'),
-- ── Read-only admin (belongs to the car-lot yard, sees only that yard) ──────────────────────────────────────────
 ('ro_admin','read own-yard vehicles',                        'read',  $$select count(*) from public.vehicles$$, '3'),
 ('ro_admin','read own-yard visits',                          'read',  $$select count(*) from public.vehicle_visits$$, '3'),
 ('ro_admin','read own-yard inspections',                     'read',  $$select count(*) from public.vehicle_inspections$$, '2'),
 ('ro_admin','read own-yard photo rows',                      'read',  $$select count(*) from public.{photos}$$, '2'),
 ('ro_admin','read manufacturers',                       'read',  $$select count(*) from public.manufacturers$$, '2'),
 ('ro_admin','create vehicle',                           'write', $$insert into public.vehicles (vin, manufacturer_id, yard_id) values ('JTDKB20U093000011','{A}','{LOT}')$$, 'error'),
 ('ro_admin','edit a visit',                             'write', $$update public.vehicle_visits set lot_zone='Z'$$, 'blocked'),
 ('ro_admin','edit a vehicle',                           'write', $$update public.vehicles set color='red'$$, 'blocked'),
 ('ro_admin','create manufacturer',                      'write', $$insert into public.manufacturers (yard_id, code, name) values ('{LOT}','MFE','E')$$, 'error'),
 ('ro_admin','get photo upload key',                      'read',  $$select public.vehicle_photo_upload_prefix('{IA1}')$$, 'error'),
 ('ro_admin','read containers',                         'read',  $$select count(*) from public.containers$$, '0'),
 ('ro_admin','read container photo + receipt buckets',    'read',  $$select count(*) from storage.objects where bucket_id in ('inspection-photos','transfer-receipts')$$, '0'),
 ('ro_admin','change own role or manufacturer',          'write', $$update public.profiles set manufacturer_id='{A}' where user_id=auth.uid()$$, 'blocked'),
-- ── Car-lot admin ──────────────────────────────────────────────────────
 ('lot_admin','create manufacturer in own lot',          'write', $$insert into public.manufacturers (yard_id, code, name) values ('{LOT}','MFC','Manufacturer C')$$, 'ok:1'),
 ('lot_admin','create manufacturer in container yard',   'write', $$insert into public.manufacturers (yard_id, code, name) values ('{EVL}','MFC','Manufacturer C')$$, 'error'),
 ('lot_admin','edit a vehicle',                          'write', $$update public.vehicles set color='red' where id='{VA1}'$$, 'ok:1'),
 ('lot_admin','read containers',                         'read',  $$select count(*) from public.containers$$, '0'),
 ('lot_admin','insert a container',                      'write', $$insert into public.containers (container_number, container_type, shipping_line) values ('MSCU0000077','20GP','MSC')$$, 'error'),
 ('lot_admin','open a container visit (blocks real gate-in)', 'write', $$insert into public.container_visits (container_id, yard_id, created_by, free_days) values ('c0000000-0000-0000-0000-000000000003','{LOT}',auth.uid(),7)$$, 'error'),
 ('lot_admin','create a container booking',              'write', $$insert into public.bookings (booking_number, customer_name, total_containers, created_by, yard_id) values ('BK-LOT','X',1,auth.uid(),'{LOT}')$$, 'error'),
 ('lot_admin','record container demurrage',              'write', $$insert into public.demurrage_payments (container_number, shipping_line, chargeable_days, demurrage_amount, total_collected, collected_by, yard_id) values ('MSCU0000001','MSC',1,1,1,auth.uid(),'{LOT}')$$, 'error'),
 ('lot_admin','upload to container receipt bucket',      'write', $$insert into storage.objects (bucket_id, name) values ('transfer-receipts','{LOT}/r.pdf')$$, 'error'),
 ('lot_admin','rpc edit a container-yard visit',         'write', $$select public.admin_edit_container('d0000000-0000-0000-0000-000000000002','{"driver_name":"x"}'::jsonb,'test')$$, 'error'),
 ('lot_admin','turn office user into manufacturer user', 'write', $$update public.profiles set manufacturer_id='{A}' where user_id='22222222-0000-0000-0000-000000000003'$$, 'blocked'),
-- ── Container-yard admin / inspector / user ────────────────────────────
 ('cy_admin','read vehicles',                            'read',  $$select count(*) from public.vehicles$$, '0'),
 ('cy_admin','read vehicle visits',                      'read',  $$select count(*) from public.vehicle_visits$$, '0'),
 ('cy_admin','read inspections',                         'read',  $$select count(*) from public.vehicle_inspections$$, '0'),
 ('cy_admin','read photo rows',                          'read',  $$select count(*) from public.{photos}$$, '0'),
 ('cy_admin','read manufacturers',                       'read',  $$select count(*) from public.manufacturers$$, '0'),
 ('cy_admin','get car photo upload key',                  'read',  $$select public.vehicle_photo_upload_prefix('{IA1}')$$, 'error'),
 ('cy_admin','create vehicle in car lot',                'write', $$insert into public.vehicles (vin, manufacturer_id, yard_id) values ('JTDKB20U093000006','{A}','{LOT}')$$, 'error'),
 ('cy_admin','create vehicle in container yard',         'write', $$insert into public.vehicles (vin, manufacturer_id, yard_id) values ('JTDKB20U093000007','{A}','{EVL}')$$, 'error'),
 ('cy_admin','create manufacturer in container yard',    'write', $$insert into public.manufacturers (yard_id, code, name) values ('{EVL}','MFZ','Z')$$, 'error'),
 ('cy_insp','read vehicles',                             'read',  $$select count(*) from public.vehicles$$, '0'),
 ('cy_insp','create vehicle in container yard',          'write', $$insert into public.vehicles (vin, manufacturer_id, yard_id) values ('JTDKB20U093000008','{A}','{EVL}')$$, 'error'),
 ('cy_user','ask whether a user is a manufacturer rep',  'read',  $$select public.is_manufacturer_rep('22222222-0000-0000-0000-000000000004')::text$$, 'error'),
-- ── Owner and anonymous ────────────────────────────────────────────────
 ('owner','read all vehicles',                           'read',  $$select count(*) from public.vehicles$$, '3'),
 ('owner','read all containers',                         'read',  $$select count(*) from public.containers$$, '6'),
 ('owner','get upload key (owner)',                       'read',  $$select public.vehicle_photo_upload_prefix('{IA1}')$$, 'aaaaaaaa-0000-0000-0000-00000000000a/ee000000-0000-0000-0000-0000000000a1/f1000000-0000-0000-0000-0000000000a1/'),
 ('mfb_rep','view A car photo (Worker gets no row)',      'read',  $$select count(*) from public.{photos} where storage_path='{pA}front.jpg'$$, '0'),
 ('anon','read vehicles',                                'read',  $$select count(*) from public.vehicles$$, '0'),
 ('anon','get photo upload key',                          'read',  $$select public.vehicle_photo_upload_prefix('{IA1}')$$, 'error'),
 ('anon','call is_manufacturer_rep()',                   'read',  $$select public.is_manufacturer_rep('22222222-0000-0000-0000-000000000004')::text$$, 'error'),
 ('anon','call is_vehicle_side_user()',                  'read',  $$select public.is_vehicle_side_user('22222222-0000-0000-0000-000000000004')::text$$, 'error');

select id as lot from public.yards where code='evl-cars' \gset
update tests set
  stmt = replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(replace(stmt,
    '{photos}', :'photos'), '{pA}', '{A}/{VA1}/{IA1}/'), '{pB}', '{B}/{VB1}/{IB1}/'),
    '{A}', 'aaaaaaaa-0000-0000-0000-00000000000a'), '{B}', 'bbbbbbbb-0000-0000-0000-00000000000b'),
    '{VA1}', 'ee000000-0000-0000-0000-0000000000a1'), '{VB1}', 'ee000000-0000-0000-0000-0000000000b1'),
    '{IA1}', 'f1000000-0000-0000-0000-0000000000a1'), '{IB1}', 'f1000000-0000-0000-0000-0000000000b1'),
    '{LOT}', :'lot'), '{EVL}', '0000000e-0000-0000-0000-0000000000e1'),
  expected = replace(expected, '{B}', 'bbbbbbbb-0000-0000-0000-00000000000b');

do $run$
declare t record; obs text; det text; rc bigint; u uuid;
begin
  for t in select * from tests order by n loop
    obs := null; det := null;
    select uid into u from actors where actor = t.actor;
    begin
      perform set_config('request.jwt.claim.sub', coalesce(u::text, ''), true);
      perform set_config('role', case when t.actor = 'anon' then 'anon' else 'authenticated' end, true);
      if t.kind = 'read' then
        execute t.stmt into obs;
      else
        execute t.stmt; get diagnostics rc = row_count; obs := 'ok:' || rc;
      end if;
      raise exception using message = '__rollback__';
    exception when others then
      if sqlerrm <> '__rollback__' then obs := 'error'; det := left(sqlerrm, 110); end if;
    end;
    update tests set observed = obs, detail = det where n = t.n;
  end loop;
end $run$;

select n, actor, label, expected, observed,
  case when (expected = 'blocked' and observed in ('ok:0','error'))
         or (expected like 'not:%' and observed is distinct from substr(expected, 5))
         or observed = expected then 'PASS' else 'FAIL' end as result,
  coalesce(detail, '') as detail
from tests order by n;
select count(*) filter (where r='PASS') as pass, count(*) filter (where r='FAIL') as fail from (
  select case when (expected = 'blocked' and observed in ('ok:0','error'))
         or (expected like 'not:%' and observed is distinct from substr(expected, 5))
         or observed = expected then 'PASS' else 'FAIL' end r from tests) x;
