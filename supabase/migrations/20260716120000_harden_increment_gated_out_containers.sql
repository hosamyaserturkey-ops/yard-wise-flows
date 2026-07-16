-- Harden increment_gated_out_containers.
--
-- This SECURITY DEFINER function is callable by any authenticated user
-- (see the earlier GRANT ... TO authenticated). Previously it would bump the
-- gated_out_containers counter on ANY booking by number, regardless of which
-- yard the caller belongs to.
--
-- Scope the update to the caller's own yard so an operator can only affect
-- bookings in their yard; super admins remain able to operate across yards.
-- This matches the multi-yard model used elsewhere (current_yard_id / RLS) and
-- does not change legitimate gate-out, which always acts on the operator's yard.

CREATE OR REPLACE FUNCTION public.increment_gated_out_containers(booking_num text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.bookings
  SET gated_out_containers = gated_out_containers + 1,
      updated_at = now()
  WHERE booking_number = booking_num
    AND (
      public.is_super_admin(auth.uid())
      OR yard_id = public.current_yard_id()
    );
END;
$function$;
