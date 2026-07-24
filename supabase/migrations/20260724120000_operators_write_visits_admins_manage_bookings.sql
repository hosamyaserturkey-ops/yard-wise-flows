-- Yard operators collaborate on containers within their yard.
--
-- Before this migration, container_visits_update allowed only:
--   super_admin OR (same yard AND (creator OR yard_admin))
-- so gate-out / reserve / unreserve / assign / unassign SILENTLY affected 0 rows
-- whenever one operator acted on a container a different operator had gated in
-- (the RLS-blocked UPDATE returned no error, and the UI reported a false success).
--
-- Widen container_visits_update so ANY operator or admin assigned to the yard can
-- perform these routine actions on ANY visit in that yard. Line reps stay
-- read-only; super admins remain global. INSERT is unchanged (still creator-based
-- and gated by the approved-inspection rule from 20260721070000).
ALTER POLICY container_visits_update ON public.container_visits
  USING (
    public.is_super_admin(auth.uid())
    OR (yard_id = public.current_yard_id() AND NOT public.is_line_rep(auth.uid()))
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR (yard_id = public.current_yard_id() AND NOT public.is_line_rep(auth.uid()))
  );

-- Bookings: status changes (cancel, auto-complete) are a yard-admin / super-admin
-- action only. Previously the creator could also update; tighten to admins so
-- cancelling a booking is an administrative operation. bookings_insert is
-- unchanged (still creator-based).
ALTER POLICY bookings_update ON public.bookings
  USING (
    public.is_super_admin(auth.uid())
    OR public.is_yard_admin(auth.uid(), yard_id)
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR public.is_yard_admin(auth.uid(), yard_id)
  );
