-- Port Data is written per yard, but the unique constraint drifted to global.
--
-- The app (PortDemurrageData.tsx) writes one container_port_data row per yard and
-- upserts with `onConflict: "container_number,yard_id"` (manual save and the Excel
-- import both fan out per yard). But migration 20260522000001 reverted the unique
-- to a single-column `UNIQUE (container_number)`. With only that constraint, the
-- composite on-conflict target has no matching unique index, so every Port Data
-- save fails with "there is no unique or exclusion constraint matching the ON
-- CONFLICT specification".
--
-- Restore the composite unique so the DB matches the per-yard code. Idempotent:
-- drops either possible constraint first, then adds the composite. (Assumes no
-- duplicate (container_number, yard_id) rows exist — expected, since saves have
-- been failing; if any duplicates are present, dedupe before applying.)
ALTER TABLE public.container_port_data
  DROP CONSTRAINT IF EXISTS container_port_data_container_number_key;

ALTER TABLE public.container_port_data
  DROP CONSTRAINT IF EXISTS container_port_data_container_number_yard_id_key;

ALTER TABLE public.container_port_data
  ADD CONSTRAINT container_port_data_container_number_yard_id_key
  UNIQUE (container_number, yard_id);
