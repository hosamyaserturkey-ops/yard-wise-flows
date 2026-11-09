-- Car-lot test fixtures, loaded as postgres AFTER the car-lot migration.
-- psql -v photos=<photo table name>
--   lot admin / inspector / office ........ 22222222-0000-0000-0000-00000000000{1,2,3}
--   manufacturer A rep / B rep ............ 22222222-0000-0000-0000-00000000000{4,5}
--   manufacturer A / B .................... aaaaaaaa-...-00000000000a / bbbbbbbb-...-00000000000b
--   vehicle A1 / B1 ....................... ee000000-...-0000000000a1 / ...b1
--   visit A1 / B1 ......................... ef000000-...-0000000000a1 / ...b1
--   inspection A1 (OPEN) / B1 (CLOSED) .... f1000000-...-0000000000a1 / ...b1
\set ON_ERROR_STOP 1
select id as lot from public.yards where code = 'evl-cars' \gset

insert into public.manufacturers (id, yard_id, code, name) values
  ('aaaaaaaa-0000-0000-0000-00000000000a', :'lot', 'MFA', 'Manufacturer A'),
  ('bbbbbbbb-0000-0000-0000-00000000000b', :'lot', 'MFB', 'Manufacturer B');

insert into auth.users (id, email, raw_user_meta_data) values
 ('22222222-0000-0000-0000-000000000001', 'lot_admin@containeryard.app',  jsonb_build_object('username','lot_admin','role','admin','yard_id', :'lot')),
 ('22222222-0000-0000-0000-000000000002', 'lot_insp@containeryard.app',   jsonb_build_object('username','lot_insp','role','inspector','yard_id', :'lot')),
 ('22222222-0000-0000-0000-000000000003', 'lot_office@containeryard.app', jsonb_build_object('username','lot_office','role','user','yard_id', :'lot')),
 ('22222222-0000-0000-0000-000000000004', 'mfa_rep@containeryard.app',    '{"username":"mfa_rep","role":"manufacturer_rep"}'),
 ('22222222-0000-0000-0000-000000000005', 'mfb_rep@containeryard.app',    '{"username":"mfb_rep","role":"manufacturer_rep"}');
-- what the create-user Edge Function would do with the service role afterwards
update public.profiles set manufacturer_id = 'aaaaaaaa-0000-0000-0000-00000000000a' where user_id = '22222222-0000-0000-0000-000000000004';
update public.profiles set manufacturer_id = 'bbbbbbbb-0000-0000-0000-00000000000b' where user_id = '22222222-0000-0000-0000-000000000005';

insert into public.vehicles (id, vin, manufacturer_id, yard_id, model) values
  ('ee000000-0000-0000-0000-0000000000a1', 'JTDKB20U093000001', 'aaaaaaaa-0000-0000-0000-00000000000a', :'lot', 'Model A'),
  ('ee000000-0000-0000-0000-0000000000b1', 'KMHCT41DAEU000001', 'bbbbbbbb-0000-0000-0000-00000000000b', :'lot', 'Model B');
insert into public.vehicle_visits (id, vehicle_id, created_by) values
  ('ef000000-0000-0000-0000-0000000000a1', 'ee000000-0000-0000-0000-0000000000a1', '22222222-0000-0000-0000-000000000002'),
  ('ef000000-0000-0000-0000-0000000000b1', 'ee000000-0000-0000-0000-0000000000b1', '22222222-0000-0000-0000-000000000002');
insert into public.vehicle_inspections (id, visit_id, phase, inspector_id) values
  ('f1000000-0000-0000-0000-0000000000a1', 'ef000000-0000-0000-0000-0000000000a1', 'gate_in', '22222222-0000-0000-0000-000000000002'),
  ('f1000000-0000-0000-0000-0000000000b1', 'ef000000-0000-0000-0000-0000000000b1', 'gate_in', '22222222-0000-0000-0000-000000000002');

insert into storage.buckets (id, name, public) values ('vehicle-inspections', 'vehicle-inspections', false) on conflict (id) do nothing;
insert into storage.objects (bucket_id, name, owner) values
  ('vehicle-inspections', 'aaaaaaaa-0000-0000-0000-00000000000a/ee000000-0000-0000-0000-0000000000a1/f1000000-0000-0000-0000-0000000000a1/front.jpg', '22222222-0000-0000-0000-000000000002'),
  ('vehicle-inspections', 'bbbbbbbb-0000-0000-0000-00000000000b/ee000000-0000-0000-0000-0000000000b1/f1000000-0000-0000-0000-0000000000b1/front.jpg', '22222222-0000-0000-0000-000000000002');
insert into public.:photos (inspection_id, angle, storage_path, taken_by) values
  ('f1000000-0000-0000-0000-0000000000a1', 'front', 'aaaaaaaa-0000-0000-0000-00000000000a/ee000000-0000-0000-0000-0000000000a1/f1000000-0000-0000-0000-0000000000a1/front.jpg', '22222222-0000-0000-0000-000000000002'),
  ('f1000000-0000-0000-0000-0000000000b1', 'front', 'bbbbbbbb-0000-0000-0000-00000000000b/ee000000-0000-0000-0000-0000000000b1/f1000000-0000-0000-0000-0000000000b1/front.jpg', '22222222-0000-0000-0000-000000000002');
-- close B1's gate-in inspection
update public.vehicle_inspections set status = 'closed' where id = 'f1000000-0000-0000-0000-0000000000b1';
-- a third car (manufacturer A) whose visit is ON HOLD, for the "no gate-out while on hold" test
insert into public.vehicles (id, vin, manufacturer_id, yard_id, model) values
  ('ee000000-0000-0000-0000-0000000000a2', 'JTDKB20U093000003', 'aaaaaaaa-0000-0000-0000-00000000000a', :'lot', 'Model A');
insert into public.vehicle_visits (id, vehicle_id, created_by, status) values
  ('ef000000-0000-0000-0000-0000000000a2', 'ee000000-0000-0000-0000-0000000000a2', '22222222-0000-0000-0000-000000000002', 'on-hold');
