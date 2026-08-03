-- Reprinted gate tickets credited the WRONG person.
--
-- Both the "Yard Supervisor" signature name and the footer line on the gate-in
-- and gate-out tickets were filled from the signed-in profile. At the gate that
-- is correct (the operator prints their own ticket), but on a REPRINT from the
-- container detail dialog it named whoever pressed print as the person who had
-- received / released the container.
--
-- Gate-in already records its operator in container_visits.created_by. Gate-out
-- recorded nothing on the visit, so add gated_out_by and backfill it from the
-- activity log: GateOut writes a 'gate_out' row whose container_id is the visit
-- id, which is the only existing record of who released a container.

ALTER TABLE public.container_visits
  ADD COLUMN IF NOT EXISTS gated_out_by uuid REFERENCES auth.users(id);

COMMENT ON COLUMN public.container_visits.gated_out_by IS
  'Operator who gated the container out. Printed on the gate-out ticket so reprints keep the original attribution instead of naming the person reprinting.';

-- Backfill closed visits from the activity log (most recent gate_out per visit).
UPDATE public.container_visits v
SET gated_out_by = a.user_id
FROM (
  SELECT DISTINCT ON (container_id) container_id, user_id
  FROM public.activity_log
  WHERE action = 'gate_out' AND container_id IS NOT NULL
  ORDER BY container_id, occurred_at DESC
) a
WHERE a.container_id = v.id
  AND v.gate_out_time IS NOT NULL
  AND v.gated_out_by IS NULL;
