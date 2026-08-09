-- profiles_update_self pinned 'role' and 'yard_id' but left 'username' free, so a
-- 'user'-role account could rename itself straight from the browser. Login derives
-- the auth email from the username (username@containeryard.app), so the rename left
-- the profile saying 'newname' while auth still expected 'oldname@...' -- an
-- unrecoverable lockout. Pin the identity columns to their current values; only the
-- create-user / reset-user-password Edge Functions (service role) may change them.
ALTER POLICY profiles_update_self ON public.profiles
  WITH CHECK (
    auth.uid() = user_id
    AND role = 'user'::public.app_role
    AND NOT (yard_id IS DISTINCT FROM (
      SELECT p.yard_id FROM public.profiles p WHERE p.user_id = auth.uid()
    ))
    AND NOT (username IS DISTINCT FROM (
      SELECT p.username FROM public.profiles p WHERE p.user_id = auth.uid()
    ))
    AND NOT (shipping_line IS DISTINCT FROM (
      SELECT p.shipping_line FROM public.profiles p WHERE p.user_id = auth.uid()
    ))
  );
