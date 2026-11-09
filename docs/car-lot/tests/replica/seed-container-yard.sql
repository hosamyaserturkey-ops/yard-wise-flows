-- Synthetic container-yard data (nothing here comes from production).
-- Fixed ids so the test scripts can refer to them.
--   yard evl ....................... 0000000e-0000-0000-0000-0000000000e1
--   super_admin .................... 11111111-0000-0000-0000-000000000001
--   container admin / inspector / user / line rep (MSC) ... ...02 / ...03 / ...04 / ...05

insert into public.yards (id, name, code, created_by)
values ('0000000e-0000-0000-0000-0000000000e1', 'Everest Logistics Services', 'evl', '11111111-0000-0000-0000-000000000001');

insert into public.shipping_lines (code, name) values ('MSC', 'MSC'), ('MAEU', 'Maersk');

insert into auth.users (id, email, raw_user_meta_data) values
 ('11111111-0000-0000-0000-000000000001', 'owner@containeryard.app',     '{"username":"owner","role":"super_admin","yard_id":"0000000e-0000-0000-0000-0000000000e1"}'),
 ('11111111-0000-0000-0000-000000000002', 'cy_admin@containeryard.app',  '{"username":"cy_admin","role":"admin","yard_id":"0000000e-0000-0000-0000-0000000000e1"}'),
 ('11111111-0000-0000-0000-000000000003', 'cy_insp@containeryard.app',   '{"username":"cy_insp","role":"inspector","yard_id":"0000000e-0000-0000-0000-0000000000e1"}'),
 ('11111111-0000-0000-0000-000000000004', 'cy_user@containeryard.app',   '{"username":"cy_user","role":"user","yard_id":"0000000e-0000-0000-0000-0000000000e1"}'),
 ('11111111-0000-0000-0000-000000000005', 'cy_rep@containeryard.app',    '{"username":"cy_rep","role":"line_rep","yard_id":"0000000e-0000-0000-0000-0000000000e1","shipping_line":"MSC"}');

insert into public.containers (id, container_number, container_type, shipping_line) values
 ('c0000000-0000-0000-0000-000000000001', 'MSCU0000001', '20GP', 'MSC'),
 ('c0000000-0000-0000-0000-000000000002', 'MSCU0000002', '40HC', 'MSC'),
 ('c0000000-0000-0000-0000-000000000003', 'MSCU0000003', '40HC', 'MSC'),
 ('c0000000-0000-0000-0000-000000000004', 'MAEU0000001', '20GP', 'MAEU'),
 ('c0000000-0000-0000-0000-000000000005', 'MAEU0000002', '40HC', 'MAEU'),
 ('c0000000-0000-0000-0000-000000000006', 'MAEU0000003', '20GP', 'MAEU');

insert into public.bookings (id, booking_number, customer_name, total_containers, created_by, yard_id, shipping_line) values
 ('b0000000-0000-0000-0000-000000000001', 'BK-MSC-1', 'Acme', 3, '11111111-0000-0000-0000-000000000002', '0000000e-0000-0000-0000-0000000000e1', 'MSC'),
 ('b0000000-0000-0000-0000-000000000002', 'BK-MAEU-1', 'Globex', 2, '11111111-0000-0000-0000-000000000002', '0000000e-0000-0000-0000-0000000000e1', 'MAEU');

insert into public.inspector_checks (id, container_number, grade, status, inspector_id, yard_id, container_type, created_at) values
 ('a0000000-0000-0000-0000-000000000001', 'MSCU0000001', 'A', 'approved', '11111111-0000-0000-0000-000000000003', '0000000e-0000-0000-0000-0000000000e1', '20GP', now() - interval '20 days'),
 ('a0000000-0000-0000-0000-000000000002', 'MSCU0000002', 'B', 'approved', '11111111-0000-0000-0000-000000000003', '0000000e-0000-0000-0000-0000000000e1', '40HC', now() - interval '15 days'),
 ('a0000000-0000-0000-0000-000000000003', 'MAEU0000001', 'A', 'approved', '11111111-0000-0000-0000-000000000003', '0000000e-0000-0000-0000-0000000000e1', '20GP', now() - interval '12 days'),
 ('a0000000-0000-0000-0000-000000000004', 'MAEU0000002', 'C', 'approved', '11111111-0000-0000-0000-000000000003', '0000000e-0000-0000-0000-0000000000e1', '40HC', now() - interval '30 days'),
 ('a0000000-0000-0000-0000-000000000005', 'MAEU0000003', 'A', 'pending',  '11111111-0000-0000-0000-000000000003', '0000000e-0000-0000-0000-0000000000e1', '20GP', now() - interval '1 day');

insert into public.container_visits (id, container_id, yard_id, gate_in_time, gate_out_time, status, driver_name, truck_number, booking_id, booking_number, free_days, yard_block, yard_row, created_by, gated_out_by) values
 ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', '0000000e-0000-0000-0000-0000000000e1', now() - interval '19 days', null, 'in-yard', 'Driver 1', 'TRK1', 'b0000000-0000-0000-0000-000000000001', 'BK-MSC-1', 7, 'A', '1', '11111111-0000-0000-0000-000000000004', null),
 ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000002', '0000000e-0000-0000-0000-0000000000e1', now() - interval '14 days', null, 'in-yard', 'Driver 2', 'TRK2', null, null, 7, 'A', '2', '11111111-0000-0000-0000-000000000004', null),
 ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000004', '0000000e-0000-0000-0000-0000000000e1', now() - interval '11 days', null, 'in-yard', 'Driver 3', 'TRK3', null, null, 7, 'B', '1', '11111111-0000-0000-0000-000000000004', null),
 ('d0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000005', '0000000e-0000-0000-0000-0000000000e1', now() - interval '29 days', now() - interval '2 days', 'out', 'Driver 4', 'TRK4', 'b0000000-0000-0000-0000-000000000002', 'BK-MAEU-1', 7, 'B', '2', '11111111-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000004'),
 ('d0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000003', '0000000e-0000-0000-0000-0000000000e1', now() - interval '40 days', now() - interval '35 days', 'out', 'Driver 5', 'TRK5', null, null, 7, 'C', '1', '11111111-0000-0000-0000-000000000004', '11111111-0000-0000-0000-000000000004');

insert into public.container_port_data (container_number, shipping_line, port_arrival_date, free_days, daily_demurrage, yard_id, container_type) values
 ('MSCU0000001', 'MSC', current_date - 25, 7, 10, '0000000e-0000-0000-0000-0000000000e1', '20GP'),
 ('MAEU0000002', 'MAEU', current_date - 35, 7, 12, '0000000e-0000-0000-0000-0000000000e1', '40HC');

insert into public.demurrage_payments (id, container_number, shipping_line, chargeable_days, demurrage_amount, total_collected, collected_by, yard_id) values
 ('e0000000-0000-0000-0000-000000000001', 'MAEU0000002', 'MAEU', 21, 252, 259, '11111111-0000-0000-0000-000000000004', '0000000e-0000-0000-0000-0000000000e1'),
 ('e0000000-0000-0000-0000-000000000002', 'MSCU0000003', 'MSC', 3, 30, 37, '11111111-0000-0000-0000-000000000004', '0000000e-0000-0000-0000-0000000000e1');

insert into public.shipping_line_transfers (id, shipping_line, amount_transferred, transferred_by, receipt_url, yard_id, payment_count) values
 ('f0000000-0000-0000-0000-000000000001', 'MSC', 30, '11111111-0000-0000-0000-000000000002', '0000000e-0000-0000-0000-0000000000e1/receipt-1.pdf', '0000000e-0000-0000-0000-0000000000e1', 1);
update public.demurrage_payments set transferred = true, transfer_id = 'f0000000-0000-0000-0000-000000000001' where id = 'e0000000-0000-0000-0000-000000000002';

insert into public.edi_transmissions (container_number, transaction_type, carrier, yard_id) values ('MSCU0000001', 'CODECO', 'MSC', '0000000e-0000-0000-0000-0000000000e1');
insert into public.cash_counts (yard_id, shift_date, shift, counted_cash, expected_cash, payment_count, counted_by) values ('0000000e-0000-0000-0000-0000000000e1', current_date - 3, 'day', 259, 259, 1, '11111111-0000-0000-0000-000000000004');
insert into public.accounting_month_closes (yard_id, month, closed_by, summary) values ('0000000e-0000-0000-0000-0000000000e1', date_trunc('month', current_date - interval '2 months')::date, '11111111-0000-0000-0000-000000000002', '{}');

insert into public.activity_log (user_id, yard_id, action, container_id, container_number, shift) values
 ('11111111-0000-0000-0000-000000000004', '0000000e-0000-0000-0000-0000000000e1', 'gate_in', 'd0000000-0000-0000-0000-000000000001', 'MSCU0000001', 'day'),
 ('11111111-0000-0000-0000-000000000004', '0000000e-0000-0000-0000-0000000000e1', 'gate_out', 'd0000000-0000-0000-0000-000000000004', 'MAEU0000002', 'night');

insert into storage.buckets (id, name, public, file_size_limit) values ('inspection-photos', 'inspection-photos', false, 5242880), ('transfer-receipts', 'transfer-receipts', false, null);
insert into storage.objects (bucket_id, name, owner) values
 ('inspection-photos', 'MSCU0000001/front.jpg', '11111111-0000-0000-0000-000000000003'),
 ('inspection-photos', 'MAEU0000001/front.jpg', '11111111-0000-0000-0000-000000000003'),
 ('transfer-receipts', '0000000e-0000-0000-0000-0000000000e1/receipt-1.pdf', '11111111-0000-0000-0000-000000000002');
