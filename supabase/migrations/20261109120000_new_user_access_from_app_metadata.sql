-- A new account's access (role, yard, shipping line) comes from app_metadata,
-- never from user_metadata.
--
-- handle_new_user read role, yard_id and shipping_line from
-- raw_user_meta_data. That column is the `data` field of the public
-- POST /auth/v1/signup (and of PUT /auth/v1/user), which anyone holding the
-- publishable key from the frontend bundle can call. With sign-up enabled,
-- a stranger could register with {"role":"super_admin"} and this SECURITY
-- DEFINER trigger wrote that role into user_roles. raw_app_meta_data can only
-- be written by the service role (the Auth admin API, as the create-user Edge
-- Function uses it), so access now comes from there alone: role defaults to
-- 'user' and yard_id to NULL when absent, and these keys in
-- raw_user_meta_data are ignored. full_name and username still come from
-- raw_user_meta_data; they grant nothing.
--
-- The Auth server's admin createUser does not put app_metadata in its INSERT.
-- In one transaction it inserts the user with app_metadata
-- {provider, providers}, then merges the caller's app_metadata in with a
-- separate UPDATE of raw_app_meta_data (adminUserCreate in supabase/auth,
-- internal/api/admin.go). So on INSERT this function finds no role and
-- provisions a plain 'user' with no yard, and the second trigger below runs
-- it again on that UPDATE, from the merged app_metadata. Should a later Auth
-- release write app_metadata in the INSERT, the INSERT does the whole job and
-- the UPDATE trigger never fires (its WHEN finds nothing changed).
--
-- The UPDATE path only acts on a user inserted earlier in the same
-- transaction: the INSERT leaves the user's id in a transaction-local setting
-- and the UPDATE checks it. So it finishes creating an account and is never a
-- way to change an existing user's access; roles are managed in user_roles
-- after creation, and editing an existing user's app_metadata changes
-- nothing here. The setting is not a security boundary (only the service
-- role can write raw_app_meta_data at all); it keeps this function's job to
-- account creation.
--
-- The UPDATE path deletes the provisional profile and user_roles rows and
-- inserts them again rather than updating them: prevent_role_change rejects
-- any change to profiles.role, and a yard_id change unless auth.uid() is an
-- admin, which it is not inside the Auth server's transaction. No foreign key
-- references profiles or user_roles, and no one has seen these rows yet.
--
-- Users who already exist are untouched. Everything else is as in
-- 20260830120000: shipping-line canonicalisation, the profile and user_roles
-- inserts, SECURITY DEFINER with a fixed search_path. The function calls no
-- RLS helper, so it works whether or not 20261011120000 has moved those to
-- the private schema.
--
-- Deploy the create-user Edge Function first, then apply this (DEPLOY.md).

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _yard_id uuid; _role public.app_role; _line text;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Only finish an account this transaction is creating.
    IF current_setting('container_yard.new_user_id', true) IS DISTINCT FROM NEW.id::text THEN
      RETURN NEW;
    END IF;
    DELETE FROM public.user_roles WHERE user_id = NEW.id;
    DELETE FROM public.profiles WHERE user_id = NEW.id;
  END IF;

  _yard_id := NULLIF(NEW.raw_app_meta_data ->> 'yard_id', '')::uuid;
  _role := COALESCE(NULLIF(NEW.raw_app_meta_data ->> 'role', ''), 'user')::public.app_role;
  _line := NULLIF(btrim(NEW.raw_app_meta_data ->> 'shipping_line'), '');
  IF _line IS NOT NULL THEN
    _line := COALESCE(
      (SELECT sl.code FROM public.shipping_lines sl
        WHERE lower(sl.code) = lower(_line) LIMIT 1),
      _line
    );
  END IF;
  INSERT INTO public.profiles (user_id, full_name, username, role, yard_id, shipping_line)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'username', NEW.email),
    NEW.raw_user_meta_data ->> 'username',
    _role, _yard_id,
    CASE WHEN _role = 'line_rep' THEN _line END
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _role);

  IF TG_OP = 'INSERT' THEN
    -- Lets the UPDATE below recognise this account until the transaction ends.
    PERFORM set_config('container_yard.new_user_id', NEW.id::text, true);
  END IF;
  RETURN NEW;
END;
$$;

-- Trigger functions can't be called over the API anyway; keep the grants as
-- they are in production (owner and service_role only).
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- on_auth_user_created (AFTER INSERT ON auth.users) already calls
-- handle_new_user and is left as it is. This adds the UPDATE half.
DROP TRIGGER IF EXISTS on_auth_user_app_metadata_set ON auth.users;
CREATE TRIGGER on_auth_user_app_metadata_set
  AFTER UPDATE OF raw_app_meta_data ON auth.users
  FOR EACH ROW
  WHEN (
       (OLD.raw_app_meta_data -> 'role')          IS DISTINCT FROM (NEW.raw_app_meta_data -> 'role')
    OR (OLD.raw_app_meta_data -> 'yard_id')       IS DISTINCT FROM (NEW.raw_app_meta_data -> 'yard_id')
    OR (OLD.raw_app_meta_data -> 'shipping_line') IS DISTINCT FROM (NEW.raw_app_meta_data -> 'shipping_line')
  )
  EXECUTE FUNCTION public.handle_new_user();
