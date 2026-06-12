
-- transfer-receipts policies: drop public-read, restrict insert to admins
DROP POLICY IF EXISTS "Anyone can view receipts" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload receipts" ON storage.objects;

CREATE POLICY "Admins can view transfer receipts"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'transfer-receipts'
  AND (public.is_super_admin(auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role))
);

CREATE POLICY "Admins can upload transfer receipts"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'transfer-receipts'
  AND (public.is_super_admin(auth.uid()) OR public.has_role(auth.uid(), 'admin'::public.app_role))
);

-- inspection-photos: tighten select
DROP POLICY IF EXISTS "inspection_photos_select" ON storage.objects;
CREATE POLICY "inspection_photos_select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'inspection-photos'
  AND (
    public.is_super_admin(auth.uid())
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'inspector'::public.app_role)
  )
);

-- inspector_checks: scope SELECT to current yard
DROP POLICY IF EXISTS inspector_checks_select ON public.inspector_checks;
CREATE POLICY inspector_checks_select ON public.inspector_checks
FOR SELECT TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (yard_id IS NOT NULL AND yard_id = public.current_yard_id())
);

-- shipping_line_transfers: SELECT admin-only
DROP POLICY IF EXISTS slt_select ON public.shipping_line_transfers;
CREATE POLICY slt_select ON public.shipping_line_transfers
FOR SELECT TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR public.is_yard_admin(auth.uid(), yard_id)
);

-- profiles_update_admin: yard admins cannot modify their own row via the
-- admin path (forces them through profiles_update_self, which blocks role and
-- yard_id changes). Super admins remain unrestricted.
DROP POLICY IF EXISTS profiles_update_admin ON public.profiles;
CREATE POLICY profiles_update_admin ON public.profiles
FOR UPDATE TO authenticated
USING (
  public.is_super_admin(auth.uid())
  OR (
    user_id <> auth.uid()
    AND yard_id IS NOT NULL
    AND public.is_yard_admin(auth.uid(), yard_id)
  )
)
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR (
    user_id <> auth.uid()
    AND yard_id IS NOT NULL
    AND public.is_yard_admin(auth.uid(), yard_id)
  )
);

-- Revoke EXECUTE on internal helpers from API roles.
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_role_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_user_role(uuid) FROM PUBLIC, anon, authenticated;
