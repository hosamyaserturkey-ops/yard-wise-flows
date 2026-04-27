-- 1. Enable RLS on edi_transmissions and add admin-only policies
ALTER TABLE public.edi_transmissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view EDI transmissions"
ON public.edi_transmissions
FOR SELECT
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can insert EDI transmissions"
ON public.edi_transmissions
FOR INSERT
TO authenticated
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update EDI transmissions"
ON public.edi_transmissions
FOR UPDATE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete EDI transmissions"
ON public.edi_transmissions
FOR DELETE
TO authenticated
USING (public.has_role(auth.uid(), 'admin'::app_role));

-- 2. Add UPDATE/DELETE storage policies on transfer-receipts (admins only)
CREATE POLICY "Admins can update transfer receipts"
ON storage.objects
FOR UPDATE
TO authenticated
USING (bucket_id = 'transfer-receipts' AND public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (bucket_id = 'transfer-receipts' AND public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete transfer receipts"
ON storage.objects
FOR DELETE
TO authenticated
USING (bucket_id = 'transfer-receipts' AND public.has_role(auth.uid(), 'admin'::app_role));

-- 3. Revoke EXECUTE on internal SECURITY DEFINER helpers from anon/authenticated.
-- These are only used by RLS policies and triggers internally, not as RPCs.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.get_user_role(uuid) FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.prevent_role_change() FROM anon, authenticated, public;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM anon, authenticated, public;

-- Keep increment_gated_out_containers callable by signed-in users (used as RPC in GateOut.tsx)
REVOKE EXECUTE ON FUNCTION public.increment_gated_out_containers(text) FROM anon, public;
GRANT EXECUTE ON FUNCTION public.increment_gated_out_containers(text) TO authenticated;