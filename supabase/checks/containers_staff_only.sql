-- Check: an account with no yard can't read or write containers, and yard
-- staff still can (20261109200000_containers_staff_only.sql).
--
-- Run it as the postgres role once that migration is applied: paste it into
-- the Supabase SQL editor, or
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/checks/containers_staff_only.sql
--
-- It writes a throwaway yard, three accounts and a container inside one
-- transaction and rolls all of it back. Each case runs as the
-- `authenticated` role with that account's JWT claims set, so RLS applies
-- exactly as it does to a request from the app. It stops with an exception
-- at the first wrong result, and otherwise ends with the notice
-- "containers staff-only: all checks passed".

BEGIN;

-- Fixtures, written as the table owner (RLS doesn't apply).
DO $fixtures$
DECLARE
  _tag   text := substr(md5(random()::text), 1, 6);
  _yard  uuid := gen_random_uuid();
  _staff uuid := gen_random_uuid();
  _boss  uuid := gen_random_uuid();
  _anon  uuid := gen_random_uuid();
  _box   text := 'ZZCK' || lpad(floor(random() * 1e7)::int::text, 7, '0');
  _new   text;
BEGIN
  LOOP
    _new := 'ZZCK' || lpad(floor(random() * 1e7)::int::text, 7, '0');
    EXIT WHEN _new <> _box;
  END LOOP;

  INSERT INTO public.yards (id, name, code, created_by)
  VALUES (_yard, 'Containers check ' || _tag, 'ZZCHK' || _tag, gen_random_uuid());

  -- Gate staff of that yard, as the create-user Edge Function makes them.
  INSERT INTO auth.users (id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  VALUES (_staff, 'authenticated', 'authenticated', 'zz-staff-' || _tag || '@example.invalid',
          jsonb_build_object('username', 'zz_staff_' || _tag),
          jsonb_build_object('provider', 'email', 'providers', '["email"]'::jsonb, 'role', 'user', 'yard_id', _yard));
  -- A super admin with no yard.
  INSERT INTO auth.users (id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  VALUES (_boss, 'authenticated', 'authenticated', 'zz-boss-' || _tag || '@example.invalid',
          jsonb_build_object('username', 'zz_boss_' || _tag),
          jsonb_build_object('provider', 'email', 'providers', '["email"]'::jsonb, 'role', 'super_admin'));
  -- A public sign-up: a plain 'user' with no yard, whatever it asked for.
  INSERT INTO auth.users (id, aud, role, email, raw_user_meta_data, raw_app_meta_data)
  VALUES (_anon, 'authenticated', 'authenticated', 'zz-signup-' || _tag || '@example.invalid',
          jsonb_build_object('username', 'zz_signup_' || _tag, 'role', 'super_admin', 'yard_id', _yard),
          '{"provider": "email", "providers": ["email"]}');

  INSERT INTO public.containers (container_number, container_type, shipping_line)
  VALUES (_box, '20GP', 'ZZCHECK');

  PERFORM set_config('zz_check.staff', _staff::text, true);
  PERFORM set_config('zz_check.boss', _boss::text, true);
  PERFORM set_config('zz_check.signup', _anon::text, true);
  PERFORM set_config('zz_check.box', _box, true);
  PERFORM set_config('zz_check.new_box', _new, true);
END
$fixtures$;

SET LOCAL ROLE authenticated;

-- 1. The yard-less sign-up sees no containers, can't change one, can't add one.
SELECT set_config('request.jwt.claim.sub', current_setting('zz_check.signup'), true),
       set_config('request.jwt.claims', json_build_object('sub', current_setting('zz_check.signup'), 'role', 'authenticated')::text, true);
DO $signup$
DECLARE _n bigint;
BEGIN
  SELECT count(*) INTO _n FROM public.containers;
  IF _n <> 0 THEN
    RAISE EXCEPTION 'FAIL account with no yard can read % containers', _n;
  END IF;

  UPDATE public.containers SET shipping_line = 'ZZHACK' WHERE container_number = current_setting('zz_check.box');
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n <> 0 THEN
    RAISE EXCEPTION 'FAIL account with no yard changed a container';
  END IF;

  BEGIN
    INSERT INTO public.containers (container_number, container_type, shipping_line)
    VALUES (current_setting('zz_check.new_box'), '20GP', 'ZZHACK');
    RAISE EXCEPTION 'FAIL account with no yard added a container';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;  -- "new row violates row-level security policy": what we want
  END;
  RAISE NOTICE 'ok: account with no yard can''t read, change or add containers';
END
$signup$;

-- 2. Gate staff with a yard still read, change and add containers.
SELECT set_config('request.jwt.claim.sub', current_setting('zz_check.staff'), true),
       set_config('request.jwt.claims', json_build_object('sub', current_setting('zz_check.staff'), 'role', 'authenticated')::text, true);
DO $staff$
DECLARE _n bigint;
BEGIN
  SELECT count(*) INTO _n FROM public.containers WHERE container_number = current_setting('zz_check.box');
  IF _n <> 1 THEN
    RAISE EXCEPTION 'FAIL yard staff can''t see the container';
  END IF;

  UPDATE public.containers SET shipping_line = 'ZZCHECK2' WHERE container_number = current_setting('zz_check.box');
  GET DIAGNOSTICS _n = ROW_COUNT;
  IF _n <> 1 THEN
    RAISE EXCEPTION 'FAIL yard staff can''t update the container';
  END IF;

  INSERT INTO public.containers (container_number, container_type, shipping_line)
  VALUES (current_setting('zz_check.new_box'), '20GP', 'ZZCHECK');
  RAISE NOTICE 'ok: yard staff read, change and add containers';
END
$staff$;

-- 3. A super admin with no yard still sees them.
SELECT set_config('request.jwt.claim.sub', current_setting('zz_check.boss'), true),
       set_config('request.jwt.claims', json_build_object('sub', current_setting('zz_check.boss'), 'role', 'authenticated')::text, true);
DO $boss$
DECLARE _n bigint;
BEGIN
  SELECT count(*) INTO _n FROM public.containers WHERE container_number = current_setting('zz_check.box');
  IF _n <> 1 THEN
    RAISE EXCEPTION 'FAIL super admin with no yard can''t see the container';
  END IF;
  RAISE NOTICE 'ok: super admin with no yard reads containers';
  RAISE NOTICE 'containers staff-only: all checks passed';
END
$boss$;

ROLLBACK;
