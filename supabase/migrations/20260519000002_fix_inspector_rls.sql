-- Drop the overly permissive policies from the first migration
DROP POLICY IF EXISTS "inspector_checks_insert" ON public.inspector_checks;
DROP POLICY IF EXISTS "inspector_checks_update" ON public.inspector_checks;
DROP POLICY IF EXISTS "inspection_photos_insert" ON storage.objects;

-- Only inspectors (or admins/super_admins) may create inspection records
CREATE POLICY "inspector_checks_insert" ON public.inspector_checks
  FOR INSERT TO authenticated
  WITH CHECK (
    inspector_id = auth.uid()
    AND (
      public.has_role(auth.uid(), 'inspector'::app_role)
      OR public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'super_admin'::app_role)
    )
  );

-- Only the inspector who created the record may update it
CREATE POLICY "inspector_checks_update" ON public.inspector_checks
  FOR UPDATE TO authenticated
  USING (
    inspector_id = auth.uid()
    AND (
      public.has_role(auth.uid(), 'inspector'::app_role)
      OR public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'super_admin'::app_role)
    )
  );

-- Only inspectors (or admins) may upload to the inspection-photos bucket
CREATE POLICY "inspection_photos_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'inspection-photos'
    AND (
      public.has_role(auth.uid(), 'inspector'::app_role)
      OR public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'super_admin'::app_role)
    )
  );
