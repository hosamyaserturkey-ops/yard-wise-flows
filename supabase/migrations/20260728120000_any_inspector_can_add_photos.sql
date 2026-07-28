-- Let any inspector/admin in the yard add photos to an existing inspection,
-- not just the inspector who originally created it. This is what makes the
-- "add photos after gate-in" flow (Photo Archive's Add Photos button)
-- workable: the inspector on shift when the container photos were actually
-- taken is often not the same person who logged the original inspection.
ALTER POLICY inspector_checks_update ON public.inspector_checks
  USING (
    is_super_admin(auth.uid())
    OR (
      yard_id = current_yard_id()
      AND (
        has_role(auth.uid(), 'admin'::app_role)
        OR has_role(auth.uid(), 'inspector'::app_role)
      )
    )
  );
