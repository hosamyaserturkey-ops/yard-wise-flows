-- URGENT FIX: the "only yard admin can edit a container" rule from the
-- previous migration was implemented too broadly. It restricted ALL
-- container_visits UPDATEs to yard admins/super admins -- but gate-out,
-- reserve, unreserve, and assign/unassign-to-booking are ALL implemented
-- as plain UPDATEs on this same table, and are core, routine operator
-- actions (not the "editing a container's details" the rule was meant
-- for, which has no dedicated UI feature at all today).
--
-- Effect since that migration: regular operators (role 'user') could no
-- longer gate a container out, reserve it, or assign/unassign it to a
-- booking -- and worse, none of these calls check the RLS-silent "0 rows
-- updated" case, so the app told them it succeeded (toast + receipt
-- print) while the database was never actually updated.
--
-- Revert to the original rule: yard admins/super admins, OR the visit's
-- own creator (the operator who gated it in), scoped to their yard.
-- Already applied directly to production; this records it in history.
ALTER POLICY container_visits_update ON public.container_visits
  USING (
    is_super_admin(auth.uid())
    OR (yard_id = current_yard_id() AND (auth.uid() = created_by OR is_yard_admin(auth.uid(), yard_id)))
  )
  WITH CHECK (
    is_super_admin(auth.uid())
    OR (yard_id = current_yard_id() AND (auth.uid() = created_by OR is_yard_admin(auth.uid(), yard_id)))
  );
