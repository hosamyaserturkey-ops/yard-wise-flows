-- inspector_checks SELECT never included the 'user' role — operators
-- (laith, ramzi, etc.) couldn't read ANY inspection data for their own
-- yard, so the "Awaiting Gate-In" queue was invisible to them and the
-- gate-in inspection-approval check (added in the previous migration)
-- always read "no inspection on file" for them, since RLS silently
-- returns zero rows rather than erroring. Widen to every non-line-rep
-- account in the yard (admin/inspector/user), matching the yard-scoping
-- pattern used elsewhere.
ALTER POLICY inspector_checks_select ON public.inspector_checks
  USING (
    is_super_admin(auth.uid())
    OR (
      yard_id IS NOT NULL
      AND yard_id = current_yard_id()
      AND NOT is_line_rep(auth.uid())
    )
  );
