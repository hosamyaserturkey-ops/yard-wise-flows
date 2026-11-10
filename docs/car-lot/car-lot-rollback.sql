-- =====================================================================
-- CAR LOT - ROLLBACK of part 2 (revision 2)
-- Only while NO real car-lot data or users exist. It refuses to run if any
-- user, log row or vehicle is attached to the car lot.
--
-- Not undone here, on purpose:
--   * the enum value 'manufacturer_rep' (Postgres cannot drop enum values;
--     unused, it changes nothing);
--   * the R2 bucket 'vehicle-inspections' (Cloudflare, not the database):
--     delete it in the Cloudflare dashboard if it was created;
--   * the schema "private": the pending repo migration 20261011120000 uses it.
-- =====================================================================
begin;

do $guard$
declare lot uuid := (select id from public.yards where code = 'evl-cars' and kind = 'vehicle');
begin
  if lot is not null and (
       exists (select 1 from public.profiles where yard_id = lot)
    or exists (select 1 from public.activity_log where yard_id = lot)
    or (to_regclass('public.vehicles') is not null and exists (select 1 from public.vehicles))
    or (to_regclass('public.manufacturers') is not null
        and exists (select 1 from public.profiles where manufacturer_id is not null))
  ) then
    raise exception 'car-lot data or users exist - rollback refused; export and decide by hand';
  end if;
end $guard$;

-- policies on existing tables and storage
drop policy if exists container_buckets_block_vehicle_side on storage.objects;
do $fence$
declare t text;
begin
  foreach t in array array[
    'containers', 'container_visits', 'inspector_checks', 'bookings',
    'demurrage_payments', 'container_port_data', 'edi_transmissions',
    'shipping_line_transfers', 'cash_counts', 'accounting_month_closes',
    'shipping_lines'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_block_vehicle_side', t);
  end loop;
end $fence$;

drop trigger if exists profiles_guard_manufacturer_trg on public.profiles;

-- new tables (their sequence, triggers, indexes and policies go with them)
drop table if exists public.vehicle_inspection_photos, public.vehicle_inspections,
                     public.vehicle_visits, public.vehicles;
alter table public.profiles drop constraint if exists profiles_manufacturer_xor_yard;
alter table public.profiles drop column if exists manufacturer_id;
drop table if exists public.manufacturers;

-- new functions
drop function if exists public.vehicle_photo_upload_prefix(uuid);
drop function if exists
  private.container_side_allowed(), private.is_vehicle_side_user(uuid),
  private.lot_is_owner(), private.lot_can_read_all(), private.lot_admin_yard(), private.lot_writer_yard(),
  private.lot_staff_yard(), private.current_manufacturer_id(),
  private.is_manufacturer_rep(uuid), private.yard_kind(uuid),
  private.lot_touch_updated_at(), private.manufacturers_guard(),
  private.profiles_guard_manufacturer(), private.vehicles_guard(),
  private.vehicle_visits_guard(), private.vehicle_inspections_guard(),
  private.vehicle_inspection_photos_guard();

-- the car-lot yard and the kind column
delete from public.yards where code = 'evl-cars' and kind = 'vehicle';
alter table public.yards drop column if exists kind;

commit;
