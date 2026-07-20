-- Enforce the container-number format at the database level too (defense in
-- depth alongside the app's zod validation): ISO 6346 layout, 4 letters
-- followed by 7 digits, e.g. MSKU1234567. All existing rows already comply.
ALTER TABLE public.containers
  ADD CONSTRAINT containers_container_number_format
  CHECK (container_number ~ '^[A-Z]{4}[0-9]{7}$');

ALTER TABLE public.container_port_data
  ADD CONSTRAINT container_port_data_container_number_format
  CHECK (container_number ~ '^[A-Z]{4}[0-9]{7}$');
