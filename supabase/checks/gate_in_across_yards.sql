-- Check: Gate In finds a box whose records are all in another yard, and
-- container_for_gate_in refuses what a gate-in couldn't do
-- (20261109210000_container_for_gate_in.sql).
--
-- Run it as the postgres role once that migration is applied: paste it into
-- the Supabase SQL editor, or
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/checks/gate_in_across_yards.sql
--
-- It writes two throwaway yards, a line, accounts and containers inside one
-- transaction and rolls all of it back. Its gate visits carry negative ticket
-- numbers, so the gate-ticket sequence does not move. It acts as each account
-- the way PostgREST does, stops with an exception at the first wrong result,
-- and otherwise ends with "gate-in across yards: all checks passed".
--
-- Containers (none has a record in yard A unless noted):
--   OUT   gated in and out of yard B, nothing since
--   OUT2  the same, a second one
--   INSB  gated out of yard B, then passed inspection in yard B
--   OPEN  still gated in at yard B
--   HERE  still gated in at yard A
--   NEW   no record anywhere

BEGIN;

CREATE FUNCTION pg_temp.make_user(_tag text, _name text, _role public.app_role, _yard uuid)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE _uid uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  VALUES (_uid, 'authenticated', 'authenticated', 'zz-' || _name || '-' || _tag || '@example.invalid', '{}',
          '{"provider": "email", "providers": ["email"]}', now(), now());
  DELETE FROM public.user_roles WHERE user_id = _uid;
  DELETE FROM public.profiles WHERE user_id = _uid;
  INSERT INTO public.profiles (user_id, full_name, username, role, yard_id, shipping_line)
  VALUES (_uid, 'Gate-in check ' || _name, 'zz_' || _name || '_' || _tag, _role, _yard,
          CASE WHEN _role = 'line_rep' THEN 'ZZLINE' END);
  INSERT INTO public.user_roles (user_id, role) VALUES (_uid, _role);
  RETURN _uid;
END $$;

-- Act as a signed-in account (or as anon when _uid is NULL), as PostgREST does.
CREATE FUNCTION pg_temp.act_as(_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', coalesce(_uid::text, ''), true);
  PERFORM set_config('request.jwt.claims',
    CASE WHEN _uid IS NULL THEN '{"role": "anon"}'
         ELSE json_build_object('sub', _uid, 'role', 'authenticated')::text END, true);
  PERFORM set_config('role', CASE WHEN _uid IS NULL THEN 'anon' ELSE 'authenticated' END, true);
END $$;

-- container_for_gate_in as the current account.
CREATE FUNCTION pg_temp.cfgi(_yard uuid, _number text, _type text, _check boolean DEFAULT false)
RETURNS uuid LANGUAGE sql AS $$
  SELECT public.container_for_gate_in(_yard, _number, _type, 'ZZLINE', _check);
$$;

-- The statement must fail with the given SQLSTATE.
CREATE FUNCTION pg_temp.expect_error(_case text, _sql text, _state text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    EXECUTE _sql;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = _state THEN
      RAISE NOTICE 'ok: % (%)', _case, SQLERRM;
      RETURN;
    END IF;
    RAISE EXCEPTION 'FAIL %: expected SQLSTATE %, got % (%)', _case, _state, SQLSTATE, SQLERRM;
  END;
  RAISE EXCEPTION 'FAIL %: it went through', _case;
END $$;

DO $check$
DECLARE
  _tag    text := substr(md5(random()::text), 1, 6);
  _digits text := lpad((floor(random() * 9000000) + 1000000)::int::text, 7, '0');
  _ticket int  := -((floor(random() * 20000000)::int + 1) * 100);  -- below every real ticket
  _yard_a uuid := gen_random_uuid();
  _yard_b uuid := gen_random_uuid();
  _out  text := 'QZGO' || _digits;
  _out2 text := 'QZGT' || _digits;
  _insb text := 'QZGI' || _digits;
  _open text := 'QZGP' || _digits;
  _here text := 'QZGH' || _digits;
  _new  text := 'QZGN' || _digits;
  _super uuid; _admin_a uuid; _op_a uuid; _insp_b uuid; _rep_a uuid; _loner uuid;
  _id uuid;
  _got uuid;
  _type text;
BEGIN
  -- ── Setup, as postgres ────────────────────────────────────────────────────
  INSERT INTO public.yards (id, name, code, created_by) VALUES
    (_yard_a, 'Gate-in check A ' || _tag, 'ZZGA' || _tag, gen_random_uuid()),
    (_yard_b, 'Gate-in check B ' || _tag, 'ZZGB' || _tag, gen_random_uuid());
  INSERT INTO public.shipping_lines (code, name) VALUES ('ZZLINE', 'Gate-in check ' || _tag)
    ON CONFLICT (code) DO NOTHING;

  _super   := pg_temp.make_user(_tag, 'super',  'super_admin', NULL);
  _admin_a := pg_temp.make_user(_tag, 'admin',  'admin',       _yard_a);
  _op_a    := pg_temp.make_user(_tag, 'op_a',   'user',        _yard_a);
  _insp_b  := pg_temp.make_user(_tag, 'insp_b', 'inspector',   _yard_b);
  _rep_a   := pg_temp.make_user(_tag, 'rep',    'line_rep',    _yard_a);
  _loner   := pg_temp.make_user(_tag, 'loner',  'user',        NULL);

  INSERT INTO public.containers (container_number, container_type, shipping_line) VALUES
    (_out, '20GP', 'ZZLINE'), (_out2, '20GP', 'ZZLINE'), (_insb, '20GP', 'ZZLINE'),
    (_open, '20GP', 'ZZLINE'), (_here, '20GP', 'ZZLINE');
  INSERT INTO public.container_visits (container_id, yard_id, created_by, ticket_number, gate_in_time, gate_out_time, status)
  SELECT c.id, v.yard, _admin_a, _ticket - v.k, now() - interval '5 days', v.out_at,
         CASE WHEN v.out_at IS NULL THEN 'in-yard' ELSE 'out' END
    FROM (VALUES (_out,  _yard_b, 1, now() - interval '2 days'),
                 (_out2, _yard_b, 2, now() - interval '2 days'),
                 (_insb, _yard_b, 3, now() - interval '2 days'),
                 (_open, _yard_b, 4, NULL::timestamptz),
                 (_here, _yard_a, 5, NULL)) AS v(num, yard, k, out_at)
    JOIN public.containers c ON c.container_number = v.num;
  INSERT INTO public.inspector_checks (container_number, grade, status, inspector_id, yard_id)
  VALUES (_insb, 'A', 'approved', _insp_b, _yard_b);

  -- ── 1. The case this fixes: an admin, no inspection or port list here ────
  PERFORM pg_temp.act_as(_admin_a);
  IF EXISTS (SELECT 1 FROM public.containers WHERE container_number = _out) THEN
    RAISE EXCEPTION 'FAIL setup: yard A admin can already see %, so this proves nothing', _out;
  END IF;
  _got := pg_temp.cfgi(_yard_a, _out, '40HC', true);
  IF _got IS NULL THEN
    RAISE EXCEPTION 'FAIL check-only call does not find % (its records are in yard B)', _out;
  END IF;
  RAISE NOTICE 'ok: check-only call finds a box whose records are all in yard B';
  _id := pg_temp.cfgi(_yard_a, _out, '40HC');
  IF _id IS DISTINCT FROM _got THEN
    RAISE EXCEPTION 'FAIL the saving call returned % instead of %', _id, _got;
  END IF;
  INSERT INTO public.container_visits (container_id, yard_id, created_by, ticket_number)
  VALUES (_id, _yard_a, _admin_a, _ticket - 6);
  SELECT container_type INTO _type FROM public.containers WHERE id = _id;
  IF _type IS DISTINCT FROM '40HC' THEN
    RAISE EXCEPTION 'FAIL the type was not updated (%), or the box is not visible after its visit', _type;
  END IF;
  RAISE NOTICE 'ok: yard A admin gates in a box last seen in yard B, and it is visible once in';

  -- ── 2. Gate staff need what the visit needs: an approved inspection ──────
  PERFORM pg_temp.act_as(_op_a);
  PERFORM pg_temp.expect_error('yard A gate staff, box last in yard B, no inspection since (check only)',
    format('SELECT pg_temp.cfgi(%L, %L, %L, true)', _yard_a, _out2, '40HC'), '23514');
  PERFORM pg_temp.expect_error('yard A gate staff, box last in yard B, no inspection since',
    format('SELECT pg_temp.cfgi(%L, %L, %L)', _yard_a, _out2, '40HC'), '23514');
  _id := pg_temp.cfgi(_yard_a, _insb, '20GP');
  INSERT INTO public.container_visits (container_id, yard_id, created_by, ticket_number)
  VALUES (_id, _yard_a, _op_a, _ticket - 7);
  RAISE NOTICE 'ok: yard A gate staff gate in a box inspected in yard B since its last gate-out';

  -- ── 3. Boxes already in a yard ──────────────────────────────────────────
  PERFORM pg_temp.act_as(_admin_a);
  PERFORM pg_temp.expect_error('a box still gated in at yard B (check only)',
    format('SELECT pg_temp.cfgi(%L, %L, %L, true)', _yard_a, _open, '20GP'), '23514');
  PERFORM pg_temp.expect_error('a box still gated in at yard B',
    format('SELECT pg_temp.cfgi(%L, %L, %L)', _yard_a, _open, '20GP'), '23514');
  PERFORM pg_temp.act_as(_op_a);
  _id := pg_temp.cfgi(_yard_a, _here, '45HC');
  EXECUTE 'RESET ROLE';
  SELECT container_type INTO _type FROM public.containers WHERE id = _id;
  IF _id IS NULL OR _type IS DISTINCT FROM '20GP' THEN
    RAISE EXCEPTION 'FAIL a box already in yard A: got id %, type % (should be unchanged)', _id, _type;
  END IF;
  RAISE NOTICE 'ok: a box already in yard A comes back unchanged, for Gate In to report';

  -- ── 4. A new box ────────────────────────────────────────────────────────
  PERFORM pg_temp.act_as(_op_a);
  IF pg_temp.cfgi(_yard_a, _new, '20GP', true) IS NOT NULL THEN
    RAISE EXCEPTION 'FAIL check-only call returned an id for a box no yard has seen';
  END IF;
  EXECUTE 'RESET ROLE';
  IF EXISTS (SELECT 1 FROM public.containers WHERE container_number = _new) THEN
    RAISE EXCEPTION 'FAIL check-only call created %', _new;
  END IF;
  PERFORM pg_temp.act_as(_op_a);
  IF pg_temp.cfgi(_yard_a, lower(_new) || ' ', '20GP') IS NULL THEN
    RAISE EXCEPTION 'FAIL the saving call did not create %', _new;
  END IF;
  RAISE NOTICE 'ok: a new box is created by the saving call only (number normalised)';
  PERFORM pg_temp.expect_error('a malformed number',
    format('SELECT pg_temp.cfgi(%L, %L, %L)', _yard_a, 'QZG' || _digits, '20GP'), '23514');

  -- ── 5. Who may call it ──────────────────────────────────────────────────
  PERFORM pg_temp.expect_error('yard A gate staff gating in at yard B',
    format('SELECT pg_temp.cfgi(%L, %L, %L)', _yard_b, _out2, '20GP'), '42501');
  PERFORM pg_temp.act_as(_rep_a);
  PERFORM pg_temp.expect_error('a line rep',
    format('SELECT pg_temp.cfgi(%L, %L, %L)', _yard_a, _out2, '20GP'), '42501');
  PERFORM pg_temp.act_as(_loner);
  PERFORM pg_temp.expect_error('a signed-in user with no yard',
    format('SELECT pg_temp.cfgi(%L, %L, %L)', _yard_a, _out2, '20GP'), '42501');
  PERFORM pg_temp.act_as(NULL);
  PERFORM pg_temp.expect_error('anon',
    format('SELECT pg_temp.cfgi(%L, %L, %L)', _yard_a, _out2, '20GP'), '42501');
  PERFORM pg_temp.act_as(_super);
  IF pg_temp.cfgi(_yard_a, _out2, '20GP') IS NULL THEN
    RAISE EXCEPTION 'FAIL a super admin (no yard of their own) cannot gate in at yard A';
  END IF;
  RAISE NOTICE 'ok: a super admin gates in at any yard';

  EXECUTE 'RESET ROLE';
  RAISE NOTICE 'gate-in across yards: all checks passed';
END
$check$;

ROLLBACK;
