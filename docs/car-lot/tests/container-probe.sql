-- Run as one signed-in user: psql -v uid=<uuid> -v role=authenticated|anon -v fingerprint=<file>.
-- Prints what the user can SEE (row count + hash per table) and what each
-- everyday container-yard ACTION does for them. Everything is rolled back.
\pset tuples_only on
\pset format unaligned
\set ON_ERROR_ROLLBACK on
begin;
select set_config('request.jwt.claim.sub', :'uid', true);
set local role :role;

\echo == visible rows
\i :fingerprint

\echo == actions
create temp table probe_out (n serial, action text, outcome text) on commit drop;
do $probe$
declare
  a record; rc bigint;
  evl constant text := '0000000e-0000-0000-0000-0000000000e1';
begin
  for a in select * from (values
    ('inspect: insert approved check',  $$insert into public.inspector_checks (container_number, grade, status, inspector_id, yard_id, container_type) values ('MSCU0000099','A','approved',auth.uid(),'0000000e-0000-0000-0000-0000000000e1','20GP')$$),
    ('gate-in: insert container',       $$insert into public.containers (id, container_number, container_type, shipping_line) values ('c0000000-0000-0000-0000-000000000099','MSCU0000099','20GP','MSC')$$),
    ('gate-in: insert visit',           $$insert into public.container_visits (container_id, yard_id, created_by, driver_name, truck_number, free_days) values ('c0000000-0000-0000-0000-000000000099','0000000e-0000-0000-0000-0000000000e1',auth.uid(),'D','T',7)$$),
    ('gate-out: update visit',          $$update public.container_visits set gate_out_time = now(), status = 'out', gated_out_by = auth.uid() where id = 'd0000000-0000-0000-0000-000000000001'$$),
    ('update container type',           $$update public.containers set container_type = '40HC' where id = 'c0000000-0000-0000-0000-000000000006'$$),
    ('collect demurrage',               $$insert into public.demurrage_payments (container_number, shipping_line, chargeable_days, demurrage_amount, total_collected, collected_by, yard_id) values ('MSCU0000001','MSC',5,50,57,auth.uid(),'0000000e-0000-0000-0000-0000000000e1')$$),
    ('create booking',                  $$insert into public.bookings (booking_number, customer_name, total_containers, created_by, yard_id, shipping_line) values ('BK-NEW','X',1,auth.uid(),'0000000e-0000-0000-0000-0000000000e1','MSC')$$),
    ('add port data',                   $$insert into public.container_port_data (container_number, shipping_line, port_arrival_date, free_days, daily_demurrage, yard_id) values ('MSCU0000002','MSC',current_date-3,7,10,'0000000e-0000-0000-0000-0000000000e1')$$),
    ('write activity log',              $$insert into public.activity_log (user_id, yard_id, action, container_number, shift) values (auth.uid(),'0000000e-0000-0000-0000-0000000000e1','gate_in','MSCU0000002','day')$$),
    ('edit own profile name',           $$update public.profiles set full_name = 'Renamed' where user_id = auth.uid()$$),
    ('upload inspection photo',         $$insert into storage.objects (bucket_id, name) values ('inspection-photos','MSCU0000099/new.jpg')$$),
    ('upload transfer receipt',         $$insert into storage.objects (bucket_id, name) values ('transfer-receipts','0000000e-0000-0000-0000-0000000000e1/new.pdf')$$),
    ('rpc admin_edit_container',        $$select public.admin_edit_container('d0000000-0000-0000-0000-000000000002', '{"driver_name":"Fixed"}'::jsonb, 'typo fix')$$),
    ('rpc void_demurrage_payment',      $$select public.void_demurrage_payment('e0000000-0000-0000-0000-000000000001', 'test void')$$),
    ('rpc increment_gated_out',         $$select public.increment_gated_out_containers('BK-MSC-1')$$)
  ) v(action, stmt) loop
    begin
      execute a.stmt;
      get diagnostics rc = row_count;
      insert into probe_out (action, outcome) values (a.action, 'ok rows=' || rc);
    exception when others then
      insert into probe_out (action, outcome) values (a.action, 'DENIED ' || sqlstate || ' ' || left(sqlerrm, 90));
    end;
  end loop;
end $probe$;
select action || ' => ' || outcome from probe_out order by n;
rollback;
