-- Check: containers are scoped to the caller's yard, and a signed-in `user`
-- with no yard gets nothing beyond shipping_lines and their own profile
-- (20261109130000_scope_containers_to_caller_yard.sql).
--
-- Run it as the postgres role once that migration is applied: paste it into
-- the Supabase SQL editor, or
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/checks/yard_scoped_access.sql
--
-- It works whether the RLS helpers are in public or private (before or after
-- 20261011120000), so run it again after applying that and 20261011130000.
--
-- It writes two throwaway yards, two lines, accounts and containers inside one
-- transaction and rolls all of it back. Its gate visits carry negative ticket
-- numbers, so the gate-ticket sequence does not move. It acts as each account
-- the way PostgREST does (role authenticated, or anon, plus the JWT claims),
-- stops with an exception at the first wrong result, and otherwise ends with
-- the notice "yard-scoped access: all checks passed".
--
-- Accounts (yard A unless noted): super admin, admin, gate staff (role user),
-- inspector, line rep (line 1), gate staff in yard B, a `user` with no yard
-- (what a public sign-up becomes), and an account whose profile names yard A
-- but which has no role in user_roles.
--
-- Containers:
--   CA  visit in A, line 1           CL  visit in A, line 2
--   CB  visit in B only              CI  visit in B (gated out), approved
--   CP  visit in B, on A's port list     inspection in A (back for a new trip)
--   CO  no visit in any yard yet (a master row whose gate-in didn't finish)

BEGIN;

-- An account with exactly the access a case needs, whatever handle_new_user
-- made of it. _role NULL: a profile but no user_roles row.
CREATE FUNCTION pg_temp.make_user(_tag text, _name text, _role public.app_role, _yard uuid, _line text DEFAULT NULL)
RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE _uid uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (id, aud, role, email, raw_user_meta_data, raw_app_meta_data, created_at, updated_at)
  VALUES (_uid, 'authenticated', 'authenticated', 'zz-' || _name || '-' || _tag || '@example.invalid', '{}',
          '{"provider": "email", "providers": ["email"]}', now(), now());
  DELETE FROM public.user_roles WHERE user_id = _uid;
  DELETE FROM public.profiles WHERE user_id = _uid;
  INSERT INTO public.profiles (user_id, full_name, username, role, yard_id, shipping_line)
  VALUES (_uid, 'Yard scope check ' || _name, 'zz_' || _name || '_' || _tag, coalesce(_role, 'user'), _yard, _line);
  IF _role IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (_uid, _role);
  END IF;
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

CREATE FUNCTION pg_temp.act_as_postgres() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END $$;

-- Which of these container numbers the current account can read.
CREATE FUNCTION pg_temp.visible(_numbers text[]) RETURNS text[] LANGUAGE sql AS $$
  SELECT coalesce(array_agg(container_number ORDER BY container_number), '{}')
    FROM public.containers WHERE container_number = ANY (_numbers);
$$;

CREATE FUNCTION pg_temp.expect_set(_case text, _got text[], _want text[]) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF _got IS DISTINCT FROM (SELECT coalesce(array_agg(x ORDER BY x), '{}') FROM unnest(_want) x) THEN
    RAISE EXCEPTION 'FAIL %: expected %, got %', _case, _want, _got;
  END IF;
  RAISE NOTICE 'ok: %', _case;
END $$;

-- The statement must be refused by RLS (or a guard trigger), or reach no row.
CREATE FUNCTION pg_temp.expect_refused(_case text, _sql text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE _n bigint;
BEGIN
  BEGIN
    EXECUTE _sql;
    GET DIAGNOSTICS _n = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege OR raise_exception THEN
    RAISE NOTICE 'ok: % (refused: %)', _case, SQLERRM;
    RETURN;
  END;
  IF _n > 0 THEN
    RAISE EXCEPTION 'FAIL %: % row(s) written', _case, _n;
  END IF;
  RAISE NOTICE 'ok: % (no row reachable)', _case;
END $$;

-- The statement must succeed and touch exactly _want rows.
CREATE FUNCTION pg_temp.expect_written(_case text, _sql text, _want bigint) RETURNS void LANGUAGE plpgsql AS $$
DECLARE _n bigint;
BEGIN
  BEGIN
    EXECUTE _sql;
    GET DIAGNOSTICS _n = ROW_COUNT;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'FAIL %: % (%)', _case, SQLERRM, SQLSTATE;
  END;
  IF _n IS DISTINCT FROM _want THEN
    RAISE EXCEPTION 'FAIL %: expected % row(s), got %', _case, _want, _n;
  END IF;
  RAISE NOTICE 'ok: %', _case;
END $$;

DO $check$
DECLARE
  _tag    text := substr(md5(random()::text), 1, 6);
  _digits text := lpad((floor(random() * 9000000) + 1000000)::int::text, 7, '0');
  _ticket int  := -((floor(random() * 20000000)::int + 1) * 100);  -- below every real ticket
  _yard_a uuid := gen_random_uuid();
  _yard_b uuid := gen_random_uuid();
  _l1 text := 'Zz1' || _tag;
  _l2 text := 'Zz2' || _tag;
  _ca text := 'QZCA' || _digits;
  _cl text := 'QZCL' || _digits;
  _cb text := 'QZCB' || _digits;
  _ci text := 'QZCI' || _digits;
  _cp text := 'QZCP' || _digits;
  _co text := 'QZCO' || _digits;
  _cn text := 'QZCN' || _digits;  -- new box, gated in by gate staff after inspection
  _cm text := 'QZCM' || _digits;  -- new box, gated in by an admin, no inspection
  _all text[];
  _in_a text[];
  _co_id uuid;
  _id uuid;
  _super uuid; _admin_a uuid; _op_a uuid; _insp_a uuid; _rep_a uuid;
  _op_b uuid; _loner uuid; _norole uuid;
  _who record;
  _rel text;
  _cnt bigint;
  _want bigint;
  _rels text[];
BEGIN
  -- ── Setup, as postgres ────────────────────────────────────────────────────
  INSERT INTO public.yards (id, name, code, created_by) VALUES
    (_yard_a, 'Scope check A ' || _tag, 'ZZA' || _tag, gen_random_uuid()),
    (_yard_b, 'Scope check B ' || _tag, 'ZZB' || _tag, gen_random_uuid());
  INSERT INTO public.shipping_lines (code, name) VALUES
    (_l1, 'Scope check 1 ' || _tag), (_l2, 'Scope check 2 ' || _tag);

  _super   := pg_temp.make_user(_tag, 'super',  'super_admin', _yard_a);
  _admin_a := pg_temp.make_user(_tag, 'admin',  'admin',       _yard_a);
  _op_a    := pg_temp.make_user(_tag, 'op_a',   'user',        _yard_a);
  _insp_a  := pg_temp.make_user(_tag, 'insp',   'inspector',   _yard_a);
  _rep_a   := pg_temp.make_user(_tag, 'rep',    'line_rep',    _yard_a, _l1);
  _op_b    := pg_temp.make_user(_tag, 'op_b',   'user',        _yard_b);
  _loner   := pg_temp.make_user(_tag, 'loner',  'user',        NULL);
  _norole  := pg_temp.make_user(_tag, 'norole', NULL,          _yard_a);

  INSERT INTO public.containers (container_number, container_type, shipping_line) VALUES
    (_ca, '20GP', _l1), (_cl, '20GP', _l2), (_cb, '20GP', _l1),
    (_ci, '20GP', _l1), (_cp, '20GP', _l1), (_co, '20GP', _l1);
  SELECT id INTO _co_id FROM public.containers WHERE container_number = _co;
  INSERT INTO public.container_visits (container_id, yard_id, created_by, ticket_number, gate_in_time, gate_out_time, status)
  SELECT c.id, v.yard, _admin_a, _ticket - v.k, now() - interval '3 days', v.out_at,
         CASE WHEN v.out_at IS NULL THEN 'in-yard' ELSE 'out' END
    FROM (VALUES (_ca, _yard_a, 1, NULL::timestamptz),
                 (_cl, _yard_a, 2, NULL),
                 (_cb, _yard_b, 3, NULL),
                 (_ci, _yard_b, 4, now() - interval '2 days'),
                 (_cp, _yard_b, 5, NULL)) AS v(num, yard, k, out_at)
    JOIN public.containers c ON c.container_number = v.num;
  INSERT INTO public.inspector_checks (container_number, grade, status, inspector_id, yard_id) VALUES
    (_ci, 'A', 'approved', _insp_a, _yard_a),
    (_cn, 'A', 'approved', _insp_a, _yard_a);
  INSERT INTO public.container_port_data (container_number, shipping_line, port_arrival_date, free_days, daily_demurrage, yard_id)
  VALUES (_cp, _l1, current_date - 5, 7, 1, _yard_a);

  _all  := ARRAY[_ca, _cl, _cb, _ci, _cp, _co];
  _in_a := ARRAY[_ca, _cl, _ci, _cp, _co];

  -- ── 1. Who reads which containers ────────────────────────────────────────
  PERFORM pg_temp.act_as(_super);
  PERFORM pg_temp.expect_set('super admin reads every yard', pg_temp.visible(_all), _all);
  PERFORM pg_temp.act_as(_admin_a);
  PERFORM pg_temp.expect_set('yard A admin reads yard A (visit, inspection, port list, no visit yet)', pg_temp.visible(_all), _in_a);
  PERFORM pg_temp.act_as(_op_a);
  PERFORM pg_temp.expect_set('yard A gate staff (role user) read yard A', pg_temp.visible(_all), _in_a);
  PERFORM pg_temp.act_as(_insp_a);
  PERFORM pg_temp.expect_set('yard A inspector reads yard A', pg_temp.visible(_all), _in_a);
  PERFORM pg_temp.act_as(_rep_a);
  PERFORM pg_temp.expect_set('yard A line rep reads their line in yard A only', pg_temp.visible(_all), ARRAY[_ca, _ci, _cp, _co]);
  PERFORM pg_temp.act_as(_op_b);
  PERFORM pg_temp.expect_set('yard B gate staff read yard B', pg_temp.visible(_all), ARRAY[_cb, _ci, _cp, _co]);
  PERFORM pg_temp.act_as(_loner);
  PERFORM pg_temp.expect_set('signed-in user with no yard reads nothing', pg_temp.visible(_all), '{}');
  PERFORM pg_temp.act_as(_norole);
  PERFORM pg_temp.expect_set('a yard on the profile but no role reads nothing', pg_temp.visible(_all), '{}');
  PERFORM pg_temp.act_as(NULL);
  PERFORM pg_temp.expect_set('anon reads nothing', pg_temp.visible(_all), '{}');

  -- ── 2. Who writes containers ─────────────────────────────────────────────
  FOR _who IN SELECT * FROM (VALUES ('signed-in user with no yard', _loner),
                                    ('role-less account', _norole),
                                    ('line rep', _rep_a),
                                    ('anon', NULL::uuid)) AS w(name, uid) LOOP
    PERFORM pg_temp.act_as(_who.uid);
    PERFORM pg_temp.expect_refused(_who.name || ' inserts a container',
      format('INSERT INTO public.containers (container_number, container_type, shipping_line) VALUES (%L, %L, %L)',
             'QZCX' || _digits, '20GP', _l1));
    PERFORM pg_temp.expect_refused(_who.name || ' updates a yard A container',
      format('UPDATE public.containers SET container_type = %L WHERE container_number = %L', '40HC', _ca));
    PERFORM pg_temp.expect_refused(_who.name || ' updates a container with no visit yet',
      format('UPDATE public.containers SET container_type = %L WHERE container_number = %L', '40HC', _co));
  END LOOP;

  PERFORM pg_temp.act_as(_op_b);
  PERFORM pg_temp.expect_refused('yard B gate staff update a yard A container',
    format('UPDATE public.containers SET shipping_line = %L WHERE container_number = %L', _l2, _ca));
  PERFORM pg_temp.act_as(_admin_a);
  PERFORM pg_temp.expect_refused('yard A admin updates a yard B container',
    format('UPDATE public.containers SET shipping_line = %L WHERE container_number = %L', _l2, _cb));
  PERFORM pg_temp.act_as(_super);
  PERFORM pg_temp.expect_written('super admin updates a yard B container',
    format('UPDATE public.containers SET container_type = %L WHERE container_number = %L', '20GP', _cb), 1);

  -- ── 3. Gate In, as the app does it (GateIn.tsx insertContainer) ──────────
  -- A box back for a new trip, inspected in yard A: read its id by number,
  -- update type and line, insert the visit.
  PERFORM pg_temp.act_as(_op_a);
  SELECT id INTO _id FROM public.containers WHERE container_number = _ci;
  IF _id IS NULL THEN
    RAISE EXCEPTION 'FAIL yard A gate staff cannot find % (inspected in their yard)', _ci;
  END IF;
  PERFORM pg_temp.expect_written('yard A gate staff update a returning box''s type and line',
    format('UPDATE public.containers SET container_type = %L, shipping_line = %L WHERE id = %L', '40HC', _l1, _id), 1);
  PERFORM pg_temp.expect_written('yard A gate staff gate the returning box in',
    format('INSERT INTO public.container_visits (container_id, yard_id, created_by, ticket_number) VALUES (%L, %L, %L, %s)',
           _id, _yard_a, _op_a, _ticket - 6), 1);

  -- A new box after inspection: insert the master row and read its id back
  -- (INSERT ... RETURNING must pass the SELECT policy), then the visit.
  _id := NULL;
  INSERT INTO public.containers (container_number, container_type, shipping_line)
  VALUES (_cn, '20GP', _l1) RETURNING id INTO _id;
  PERFORM pg_temp.expect_written('yard A gate staff gate a new box in',
    format('INSERT INTO public.container_visits (container_id, yard_id, created_by, ticket_number) VALUES (%L, %L, %L, %s)',
           _id, _yard_a, _op_a, _ticket - 7), 1);
  RAISE NOTICE 'ok: yard A gate staff insert a new container and read its id back';

  -- An admin gating in a new box with no inspection and no port-list entry.
  PERFORM pg_temp.act_as(_admin_a);
  _id := NULL;
  INSERT INTO public.containers (container_number, container_type, shipping_line)
  VALUES (_cm, '20GP', _l1) RETURNING id INTO _id;
  PERFORM pg_temp.expect_written('yard A admin gates a new uninspected box in',
    format('INSERT INTO public.container_visits (container_id, yard_id, created_by, ticket_number) VALUES (%L, %L, %L, %s)',
           _id, _yard_a, _admin_a, _ticket - 8), 1);
  RAISE NOTICE 'ok: yard A admin inserts a new container and reads its id back';

  PERFORM pg_temp.act_as(_op_b);
  PERFORM pg_temp.expect_set('once gated in to yard A, the new boxes are hidden from yard B',
    pg_temp.visible(ARRAY[_cn, _cm]), '{}');

  -- ── 4. Every table, as the signed-in user with no yard, and as anon ──────
  PERFORM pg_temp.act_as_postgres();
  SELECT array_agg(format('%I.%I', n.nspname, c.relname) ORDER BY n.nspname, c.relname) INTO _rels
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE (n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p', 'f'))
      OR (n.nspname = 'storage' AND c.relname = 'objects');

  FOR _who IN SELECT * FROM (VALUES ('signed-in user with no yard', _loner), ('anon', NULL::uuid)) AS w(name, uid) LOOP
    PERFORM pg_temp.act_as(_who.uid);
    FOREACH _rel IN ARRAY _rels LOOP
      BEGIN
        EXECUTE format('SELECT count(*) FROM %s', _rel) INTO _cnt;
      EXCEPTION WHEN insufficient_privilege THEN
        _cnt := 0;  -- no grant at all: nothing readable either
      END;
      _want := CASE
        WHEN _who.uid IS NULL THEN 0
        WHEN _rel IN ('public.profiles', 'public.user_roles') THEN 1  -- their own row
        WHEN _rel = 'public.shipping_lines' THEN NULL               -- reference data
        ELSE 0 END;
      IF _want IS NULL THEN
        IF _cnt < 2 THEN
          RAISE EXCEPTION 'FAIL %: cannot read shipping_lines (% rows)', _who.name, _cnt;
        END IF;
      ELSIF _cnt <> _want THEN
        RAISE EXCEPTION 'FAIL %: reads % row(s) of %, expected %', _who.name, _cnt, _rel, _want;
      END IF;
    END LOOP;
    RAISE NOTICE 'ok: % reads only what it should across % tables and views', _who.name, cardinality(_rels);
  END LOOP;

  PERFORM pg_temp.act_as(_loner);
  IF (SELECT user_id FROM public.profiles) IS DISTINCT FROM _loner
     OR (SELECT user_id FROM public.user_roles) IS DISTINCT FROM _loner THEN
    RAISE EXCEPTION 'FAIL signed-in user with no yard: the profile or role row it reads is not its own';
  END IF;

  -- Writes into yard A's tables, all refused.
  PERFORM pg_temp.expect_refused('no-yard user logs activity in yard A',
    format('INSERT INTO public.activity_log (user_id, yard_id, action, shift) VALUES (%L, %L, %L, %L)', _loner, _yard_a, 'gate_in', 'day'));
  PERFORM pg_temp.expect_refused('no-yard user creates a booking in yard A',
    format('INSERT INTO public.bookings (booking_number, customer_name, total_containers, created_by, yard_id) VALUES (%L, %L, 1, %L, %L)',
           'ZZBK' || _tag, 'Scope check', _loner, _yard_a));
  PERFORM pg_temp.expect_refused('no-yard user gates a container in to yard A',
    format('INSERT INTO public.container_visits (container_id, yard_id, created_by, ticket_number) VALUES (%L, %L, %L, %s)',
           _co_id, _yard_a, _loner, _ticket - 9));
  PERFORM pg_temp.expect_refused('no-yard user records a payment in yard A',
    format('INSERT INTO public.demurrage_payments (container_number, shipping_line, chargeable_days, demurrage_amount, total_collected, collected_by, yard_id) VALUES (%L, %L, 0, 0, 0, %L, %L)',
           _ca, _l1, _loner, _yard_a));
  PERFORM pg_temp.expect_refused('no-yard user adds port data to yard A',
    format('INSERT INTO public.container_port_data (container_number, shipping_line, port_arrival_date, free_days, daily_demurrage, yard_id) VALUES (%L, %L, current_date, 7, 1, %L)',
           _ca, _l1, _yard_a));
  PERFORM pg_temp.expect_refused('no-yard user files an inspection in yard A',
    format('INSERT INTO public.inspector_checks (container_number, grade, status, inspector_id, yard_id) VALUES (%L, %L, %L, %L, %L)',
           _ca, 'A', 'approved', _loner, _yard_a));
  PERFORM pg_temp.expect_refused('no-yard user adds an EDI message in yard A',
    format('INSERT INTO public.edi_transmissions (container_number, transaction_type, carrier, yard_id) VALUES (%L, %L, %L, %L)',
           _ca, 'gate_in', _l1, _yard_a));
  PERFORM pg_temp.expect_refused('no-yard user grants itself admin',
    format('INSERT INTO public.user_roles (user_id, role) VALUES (%L, %L)', _loner, 'admin'));
  PERFORM pg_temp.expect_refused('no-yard user creates a yard',
    format('INSERT INTO public.yards (name, code, created_by) VALUES (%L, %L, %L)', 'Scope check C', 'ZZC' || _tag, _loner));
  PERFORM pg_temp.expect_refused('no-yard user adds a shipping line',
    format('INSERT INTO public.shipping_lines (code, name) VALUES (%L, %L)', 'Zz3' || _tag, 'Scope check 3'));
  PERFORM pg_temp.expect_refused('no-yard user moves its profile into yard A',
    format('UPDATE public.profiles SET yard_id = %L WHERE user_id = %L', _yard_a, _loner));
  PERFORM pg_temp.expect_refused('no-yard user deletes its profile',
    format('DELETE FROM public.profiles WHERE user_id = %L', _loner));
  PERFORM pg_temp.expect_written('no-yard user renames itself (its own profile)',
    format('UPDATE public.profiles SET full_name = %L WHERE user_id = %L', 'Renamed', _loner), 1);

  -- If its profile row is ever gone, it can't re-create it inside a yard.
  PERFORM pg_temp.act_as_postgres();
  DELETE FROM public.profiles WHERE user_id = _loner;
  PERFORM pg_temp.act_as(_loner);
  PERFORM pg_temp.expect_refused('account without a profile re-creates it in yard A',
    format('INSERT INTO public.profiles (user_id, full_name, role, yard_id) VALUES (%L, %L, %L, %L)', _loner, 'x', 'user', _yard_a));
  PERFORM pg_temp.expect_refused('account without a profile re-creates it as admin',
    format('INSERT INTO public.profiles (user_id, full_name, role) VALUES (%L, %L, %L)', _loner, 'x', 'admin'));
  PERFORM pg_temp.expect_written('account without a profile re-creates a plain one',
    format('INSERT INTO public.profiles (user_id, full_name) VALUES (%L, %L)', _loner, 'x'), 1);

  PERFORM pg_temp.act_as_postgres();
  RAISE NOTICE 'yard-scoped access: all checks passed';
END
$check$;

ROLLBACK;
