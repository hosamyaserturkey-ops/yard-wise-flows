-- Two related access-control rules requested for real-yard operations:
--
-- 1. Gate-in (opening a container_visits row) now requires a fresh,
--    APPROVED inspection on file for that trip, for regular (non-admin)
--    accounts. Previously any signed-in operator could type an uninspected
--    container straight into the Gate In form and complete the gate-in —
--    the "Awaiting Gate-In" queue was only a UI convenience, not enforced.
--    Yard admins and super admins are exempt (their manual/bulk-import path
--    is the intended override for corrections and historical backfills).
--
-- 2. Editing an existing container visit (truck/driver/block/etc. after the
--    fact) is now yard-admin/super-admin only. Previously the creator could
--    also edit their own entry.

CREATE OR REPLACE FUNCTION public.has_approved_inspection_for_trip(_container_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.inspector_checks ic
    JOIN public.containers c ON c.container_number = ic.container_number
    WHERE c.id = _container_id
      AND ic.status = 'approved'
      -- Scoped to the CURRENT trip: an approval from before the container's
      -- last gate-out must not satisfy a new trip's gate-in.
      AND ic.created_at > COALESCE(
        (SELECT max(v.gate_out_time) FROM public.container_visits v
         WHERE v.container_id = _container_id AND v.gate_out_time IS NOT NULL),
        '-infinity'::timestamptz
      )
  );
$$;

GRANT EXECUTE ON FUNCTION public.has_approved_inspection_for_trip(uuid) TO authenticated;

ALTER POLICY container_visits_insert ON public.container_visits
  WITH CHECK (
    (auth.uid() = created_by)
    AND NOT public.is_line_rep(auth.uid())
    AND (
      is_super_admin(auth.uid())
      OR (
        yard_id = current_yard_id()
        AND (
          is_yard_admin(auth.uid(), yard_id)
          OR public.has_approved_inspection_for_trip(container_id)
        )
      )
    )
  );

ALTER POLICY container_visits_update ON public.container_visits
  USING (is_super_admin(auth.uid()) OR is_yard_admin(auth.uid(), yard_id))
  WITH CHECK (is_super_admin(auth.uid()) OR is_yard_admin(auth.uid(), yard_id));
