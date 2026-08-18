-- The inspector is standing at the container, so they now record its ISO type
-- (size first, then type) as part of the inspection. The type rides through to
-- the approved-inspection queue and pre-fills the gate-in form, so the operator
-- only picks the shipping line, driver, truck and yard slot.
--
-- Nullable: required in the UI from here on, but inspections recorded before
-- this column existed have no type and must keep loading.
ALTER TABLE public.inspector_checks
  ADD COLUMN IF NOT EXISTS container_type text;
