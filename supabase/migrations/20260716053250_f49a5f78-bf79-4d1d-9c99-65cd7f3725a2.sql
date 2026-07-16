
DROP POLICY IF EXISTS inspector_checks_select ON public.inspector_checks;
CREATE POLICY inspector_checks_select ON public.inspector_checks
FOR SELECT TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (
    yard_id IS NOT NULL
    AND yard_id = public.current_yard_id()
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'inspector'::public.app_role)
    )
  )
);
