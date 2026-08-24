-- Record the seal fitted to a container when it leaves the yard.
--
-- The seal number is the physical tamper-evident seal on the container doors:
-- it identifies the load at the gate and on the delivery note, and is what a
-- later dispute is checked against. It is captured at gate-out (a container
-- can be re-sealed while it stands in the yard), so it belongs on the visit
-- rather than on the master container row.
--
-- Nullable: every visit gated out before this migration has no seal on file,
-- and gate-in doesn't collect one. The requirement is enforced at gate-out by
-- the app, which now refuses to release a container without a seal number.
ALTER TABLE public.container_visits
  ADD COLUMN IF NOT EXISTS seal_number text;

COMMENT ON COLUMN public.container_visits.seal_number IS
  'Seal fitted to the container at gate-out. Null for visits gated out before seals were recorded.';
