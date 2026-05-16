-- Fix 1: Prevent users from changing their own yard_id (yard-hopping)
CREATE OR REPLACE FUNCTION public.prevent_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Cannot change role via profiles table';
  END IF;
  -- Block yard_id changes unless caller is super_admin or a yard admin of the
  -- target's current or new yard. This prevents users from self-assigning to a
  -- different yard via the profiles_update_self policy.
  IF NEW.yard_id IS DISTINCT FROM OLD.yard_id THEN
    IF NOT (
      public.is_super_admin(auth.uid())
      OR (OLD.yard_id IS NOT NULL AND public.is_yard_admin(auth.uid(), OLD.yard_id))
      OR (NEW.yard_id IS NOT NULL AND public.is_yard_admin(auth.uid(), NEW.yard_id))
    ) THEN
      RAISE EXCEPTION 'Cannot change yard_id';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS prevent_role_change_trigger ON public.profiles;
CREATE TRIGGER prevent_role_change_trigger
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.prevent_role_change();

-- Defense-in-depth: tighten the self-update WITH CHECK
DROP POLICY IF EXISTS profiles_update_self ON public.profiles;
CREATE POLICY profiles_update_self ON public.profiles
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id
  AND role = 'user'::app_role
  AND yard_id IS NOT DISTINCT FROM (SELECT yard_id FROM public.profiles WHERE user_id = auth.uid())
);

-- Fix 2 & 3: Add UPDATE and DELETE policies on shipping_line_transfers (yard admins / super admin only)
CREATE POLICY slt_update ON public.shipping_line_transfers
FOR UPDATE
USING (public.is_super_admin(auth.uid()) OR public.is_yard_admin(auth.uid(), yard_id))
WITH CHECK (public.is_super_admin(auth.uid()) OR public.is_yard_admin(auth.uid(), yard_id));

CREATE POLICY slt_delete ON public.shipping_line_transfers
FOR DELETE
USING (public.is_super_admin(auth.uid()) OR public.is_yard_admin(auth.uid(), yard_id));

-- Fix 4: Revoke EXECUTE from anon on internal SECURITY DEFINER helper functions
REVOKE EXECUTE ON FUNCTION public.is_super_admin(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.is_yard_admin(uuid, uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.current_yard_id() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_user_role(uuid) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.increment_gated_out_containers(text) FROM anon, public;

GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_yard_admin(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_yard_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_gated_out_containers(text) TO authenticated;