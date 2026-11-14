-- Removes the car-lot retention job's database objects. Deleted data is NOT restored
-- (nothing can restore it). Also remove RETENTION_TOKEN and the cron trigger from the Worker.
begin;
drop function if exists public.car_lot_retention_run(text, boolean);
drop function if exists public.car_lot_retention_ack(text, text[]);
drop function if exists private.retention_check_token(text);
drop table if exists public.retention_log;
drop table if exists private.retention_pending_files;
drop table if exists private.retention_settings;
commit;
