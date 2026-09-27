-- Keep the gate-out driver and truck apart from the gate-in ones.
--
-- A visit had a single driver_name / truck_number pair. Gate-in filled it with
-- the driver who delivered the container, and gate-out then overwrote it with
-- the driver who collected it — so once a container left, nothing recorded who
-- had brought it in. Gate-out now writes these two columns instead, and
-- driver_name / truck_number stay the gate-in driver and truck for good.
--
-- Backfill: on every visit already gated out, driver_name / truck_number hold
-- the gate-out values (gate-out has always overwritten them), so copy them
-- across. The gate-in columns of those visits are deliberately left as they
-- are — the original gate-in values were never kept anywhere, so on those
-- visits both sides show the gate-out driver and truck.
ALTER TABLE public.container_visits
  ADD COLUMN IF NOT EXISTS gate_out_driver_name text,
  ADD COLUMN IF NOT EXISTS gate_out_truck_number text;

UPDATE public.container_visits
SET gate_out_driver_name = driver_name,
    gate_out_truck_number = truck_number
WHERE gate_out_time IS NOT NULL
  AND gate_out_driver_name IS NULL
  AND gate_out_truck_number IS NULL;

COMMENT ON COLUMN public.container_visits.driver_name IS
  'Driver who delivered the container at gate-in. On visits gated out before 2026-09-27 this holds the gate-out driver instead: gate-out used to overwrite it.';
COMMENT ON COLUMN public.container_visits.truck_number IS
  'Truck that delivered the container at gate-in. On visits gated out before 2026-09-27 this holds the gate-out truck instead: gate-out used to overwrite it.';
COMMENT ON COLUMN public.container_visits.gate_out_driver_name IS
  'Driver who collected the container at gate-out. Null while the container is still in the yard.';
COMMENT ON COLUMN public.container_visits.gate_out_truck_number IS
  'Truck that collected the container at gate-out. Null while the container is still in the yard.';
