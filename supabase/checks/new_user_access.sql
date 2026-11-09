-- Check: a new account's role, yard and shipping line come from app_metadata
-- only (20261109120000_new_user_access_from_app_metadata.sql).
--
-- Run it as the postgres role once that migration is applied: paste it into
-- the Supabase SQL editor, or
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/checks/new_user_access.sql
--
-- It writes throwaway users, a yard and a shipping line inside one
-- transaction and rolls all of it back, so nothing is left behind. It stops
-- with an exception at the first wrong result, and otherwise ends with the
-- notice "new-user access: all checks passed".
--
-- Each case replays the statements the Auth server runs, in its order:
--   public sign-up    INSERT with the caller's `data` as raw_user_meta_data
--                     and app_metadata {provider, providers}
--   admin createUser  the same INSERT (no caller app_metadata yet), then
--                     UPDATE role, UPDATE raw_app_meta_data (merging the
--                     caller's app_metadata), UPDATE email_confirmed_at,
--                     UPDATE raw_user_meta_data (email_verified)
-- A "later transaction" is stood in for by clearing the transaction-local
-- marker the INSERT trigger leaves behind.

BEGIN;

CREATE FUNCTION pg_temp.sign_up(_email text, _data jsonb)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE _uid uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  VALUES (_uid, 'authenticated', 'authenticated', _email, _data,
          '{"provider": "email", "providers": ["email"]}', now(), now());
  -- After creating the identity the Auth server rewrites the provider keys.
  UPDATE auth.users
     SET raw_app_meta_data = raw_app_meta_data || '{"provider": "email", "providers": ["email"]}'
   WHERE id = _uid;
  RETURN _uid;
END $$;

CREATE FUNCTION pg_temp.admin_create_user(_email text, _user_metadata jsonb, _app_metadata jsonb)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE _uid uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  VALUES (_uid, 'authenticated', '', _email, _user_metadata,
          '{"provider": "email", "providers": ["email"]}', now(), now());
  UPDATE auth.users SET role = 'authenticated' WHERE id = _uid;
  UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || _app_metadata WHERE id = _uid;
  UPDATE auth.users SET email_confirmed_at = now() WHERE id = _uid;
  UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data || '{"email_verified": true}' WHERE id = _uid;
  RETURN _uid;
END $$;

CREATE FUNCTION pg_temp.expect_access(_case text, _uid uuid, _role text, _yard uuid, _line text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE _p record; _roles text[];
BEGIN
  SELECT role::text AS role, yard_id, shipping_line INTO _p FROM public.profiles WHERE user_id = _uid;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'FAIL %: no profile row', _case;
  END IF;
  SELECT array_agg(role::text ORDER BY role::text) INTO _roles FROM public.user_roles WHERE user_id = _uid;
  IF _p.role IS DISTINCT FROM _role
     OR _p.yard_id IS DISTINCT FROM _yard
     OR _p.shipping_line IS DISTINCT FROM _line
     OR _roles IS DISTINCT FROM ARRAY[_role] THEN
    RAISE EXCEPTION 'FAIL %: expected role %, yard %, line %, user_roles {%}; got role %, yard %, line %, user_roles %',
      _case, _role, _yard, _line, _role, _p.role, _p.yard_id, _p.shipping_line, _roles;
  END IF;
  RAISE NOTICE 'ok: %', _case;
END $$;

DO $check$
DECLARE
  _tag  text := substr(md5(random()::text), 1, 6);
  _yard uuid := gen_random_uuid();
  _line text := 'Zz' || _tag;  -- mixed case, to see it canonicalised
  _uid  uuid;
  _p    record;
BEGIN
  INSERT INTO public.yards (id, name, code, created_by)
  VALUES (_yard, 'Access check ' || _tag, 'ZZCHK' || _tag, gen_random_uuid());
  INSERT INTO public.shipping_lines (code, name) VALUES (_line, 'Access check ' || _tag);

  -- 1. A public sign-up asking for super_admin, a yard and a line gets none of them.
  _uid := pg_temp.sign_up('zz-signup-' || _tag || '@example.invalid',
    jsonb_build_object('role', 'super_admin', 'yard_id', _yard, 'shipping_line', _line,
                       'username', 'zz_signup_' || _tag, 'full_name', 'Access check'));
  PERFORM pg_temp.expect_access('sign-up with role super_admin in user_metadata', _uid, 'user', NULL, NULL);

  -- 2. ...nor by editing its own user_metadata later (PUT /auth/v1/user).
  PERFORM set_config('container_yard.new_user_id', '', true);
  UPDATE auth.users SET raw_user_meta_data = raw_user_meta_data || '{"role": "super_admin"}' WHERE id = _uid;
  PERFORM pg_temp.expect_access('later user_metadata edit', _uid, 'user', NULL, NULL);

  -- 3. The create-user Edge Function's line rep: access from app_metadata,
  --    line canonicalised, a stray role in user_metadata ignored, name kept.
  _uid := pg_temp.admin_create_user('zz-rep-' || _tag || '@example.invalid',
    jsonb_build_object('full_name', 'Access check rep', 'username', 'zz_rep_' || _tag, 'role', 'super_admin'),
    jsonb_build_object('role', 'line_rep', 'yard_id', _yard, 'shipping_line', lower(_line)));
  PERFORM pg_temp.expect_access('admin-created line rep', _uid, 'line_rep', _yard, _line);
  SELECT full_name, username INTO _p FROM public.profiles WHERE user_id = _uid;
  IF _p.full_name IS DISTINCT FROM 'Access check rep' OR _p.username IS DISTINCT FROM 'zz_rep_' || _tag THEN
    RAISE EXCEPTION 'FAIL admin-created line rep: name/username not kept (got %, %)', _p.full_name, _p.username;
  END IF;

  -- 4. The create-user Edge Function's yard admin.
  _uid := pg_temp.admin_create_user('zz-admin-' || _tag || '@example.invalid',
    jsonb_build_object('full_name', 'Access check admin', 'username', 'zz_admin_' || _tag),
    jsonb_build_object('role', 'admin', 'yard_id', _yard));
  PERFORM pg_temp.expect_access('admin-created yard admin', _uid, 'admin', _yard, NULL);

  -- 5. Editing an existing account's app_metadata later changes nothing:
  --    roles are managed in user_roles after creation.
  PERFORM set_config('container_yard.new_user_id', '', true);
  UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role": "super_admin"}' WHERE id = _uid;
  PERFORM pg_temp.expect_access('later app_metadata edit', _uid, 'admin', _yard, NULL);

  RAISE NOTICE 'new-user access: all checks passed';
END
$check$;

ROLLBACK;
