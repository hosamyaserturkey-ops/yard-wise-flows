-- Check: gate operators (role user) add and update their own yard's port data,
-- and nothing else changes (20261127120000_operators_manage_port_data.sql).
--
-- Run it as the postgres role once that migration is applied: paste it into
-- the Supabase SQL editor, or
--
--   psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f supabase/checks/operators_port_data.sql
--
-- It writes three throwaway yards, accounts and port data rows inside one
-- transaction and rolls all of it back. It acts as each account the way
-- PostgREST does (role authenticated plus the JWT claims), stops with an
-- exception at the first wrong result, and otherwise ends with the notice
-- "operators port data: all checks passed".
--
-- Accounts (yard A unless noted): super admin, admin, gate operator (role
-- user), inspector, read-only admin, line rep (line 1), gate operator in yard
-- B, gate operator in car-lot yard V, and a `user` with no yard.
--
-- Port data rows, written as postgres:
--   P1  yard A, line 1        P2  yard A, line 2        PB  yard B, line 1

BEGIN;

-- An account with exactly the access a case needs, whatever handle_new_user
-- made of it.
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
  VALUES (_uid, 'Port data check ' || _name, 'zz_' || _name || '_' || _tag, _role, _yard, _line);
  INSERT INTO public.user_roles (user_id, role) VALUES (_uid, _role);
  RETURN _uid;
END $$;

-- Act as a signed-in account, as PostgREST does.
CREATE FUNCTION pg_temp.act_as(_uid uuid) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', _uid::text, true);
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  PERFORM set_config('role', 'authenticated', true);
END $$;

CREATE FUNCTION pg_temp.act_as_postgres() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE 'RESET ROLE';
  PERFORM set_config('request.jwt.claim.sub', '', true);
  PERFORM set_config('request.jwt.claims', '', true);
END $$;

-- The statement must be refused by RLS, or reach no row.
CREATE FUNCTION pg_temp.expect_refused(_case text, _sql text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE _n bigint;
BEGIN
  BEGIN
    EXECUTE _sql;
    GET DIAGNOSTICS _n = ROW_COUNT;
  EXCEPTION WHEN insufficient_privilege THEN
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

-- A new port data row, the way the Port Data page's manual entry writes one.
CREATE FUNCTION pg_temp.add_row(_number text, _line text, _yard uuid) RETURNS text LANGUAGE sql AS $$
  SELECT format('INSERT INTO public.container_port_data (container_number, shipping_line, container_type, port_arrival_date, free_days, daily_demurrage, last_source, yard_id) VALUES (%L, %L, %L, current_date - 3, 7, 0, %L, %L)',
                _number, _line, '20GP', 'manual', _yard);
$$;

-- The Excel import and manual entry both upsert on (container_number, yard_id).
CREATE FUNCTION pg_temp.upsert_row(_number text, _line text, _yard uuid, _free int) RETURNS text LANGUAGE sql AS $$
  SELECT format('INSERT INTO public.container_port_data (container_number, shipping_line, container_type, port_arrival_date, free_days, daily_demurrage, last_source, yard_id) VALUES (%L, %L, %L, current_date - 4, %s, 0, %L, %L) ON CONFLICT (container_number, yard_id) DO UPDATE SET shipping_line = EXCLUDED.shipping_line, container_type = EXCLUDED.container_type, port_arrival_date = EXCLUDED.port_arrival_date, free_days = EXCLUDED.free_days, last_source = EXCLUDED.last_source',
                _number, _line, '20GP', _free, 'excel', _yard);
$$;

DO $check$
DECLARE
  _tag    text := substr(md5(random()::text), 1, 6);
  _digits text := lpad((floor(random() * 9000000) + 1000000)::int::text, 7, '0');
  _yard_a uuid := gen_random_uuid();
  _yard_b uuid := gen_random_uuid();
  _yard_v uuid := gen_random_uuid();
  _l1 text := 'Zz1' || _tag;
  _l2 text := 'Zz2' || _tag;
  _p1 text := 'QZPA' || _digits;
  _p2 text := 'QZPL' || _digits;
  _pb text := 'QZPB' || _digits;
  _super uuid; _admin_a uuid; _op_a uuid; _insp_a uuid; _ro_a uuid; _rep_a uuid;
  _op_b uuid; _op_v uuid; _loner uuid;
  _free int;
BEGIN
  -- ── Setup, as postgres ────────────────────────────────────────────────────
  INSERT INTO public.yards (id, name, code, created_by, kind) VALUES
    (_yard_a, 'Port data check A ' || _tag, 'ZPA' || _tag, gen_random_uuid(), 'container'),
    (_yard_b, 'Port data check B ' || _tag, 'ZPB' || _tag, gen_random_uuid(), 'container'),
    (_yard_v, 'Port data check V ' || _tag, 'ZPV' || _tag, gen_random_uuid(), 'vehicle');

  _super   := pg_temp.make_user(_tag, 'super', 'super_admin',     _yard_a);
  _admin_a := pg_temp.make_user(_tag, 'admin', 'admin',           _yard_a);
  _op_a    := pg_temp.make_user(_tag, 'op_a',  'user',            _yard_a);
  _insp_a  := pg_temp.make_user(_tag, 'insp',  'inspector',       _yard_a);
  _ro_a    := pg_temp.make_user(_tag, 'ro',    'read_only_admin', _yard_a);
  _rep_a   := pg_temp.make_user(_tag, 'rep',   'line_rep',        _yard_a, _l1);
  _op_b    := pg_temp.make_user(_tag, 'op_b',  'user',            _yard_b);
  _op_v    := pg_temp.make_user(_tag, 'op_v',  'user',            _yard_v);
  _loner   := pg_temp.make_user(_tag, 'loner', 'user',            NULL);

  INSERT INTO public.container_port_data (container_number, shipping_line, port_arrival_date, free_days, daily_demurrage, yard_id) VALUES
    (_p1, _l1, current_date - 5, 7, 0, _yard_a),
    (_p2, _l2, current_date - 5, 7, 0, _yard_a),
    (_pb, _l1, current_date - 5, 7, 0, _yard_b);

  -- ── 1. The gate operator, in their own yard ──────────────────────────────
  PERFORM pg_temp.act_as(_op_a);
  PERFORM pg_temp.expect_written('operator adds a port data row in their yard (manual entry)',
    pg_temp.add_row('QZPN' || _digits, _l1, _yard_a), 1);
  PERFORM pg_temp.expect_written('operator re-imports an existing row in their yard (upsert)',
    pg_temp.upsert_row(_p1, _l1, _yard_a, 21), 1);
  PERFORM pg_temp.expect_written('operator imports a new row in their yard (upsert)',
    pg_temp.upsert_row('QZPI' || _digits, _l2, _yard_a, 14), 1);
  PERFORM pg_temp.expect_written('operator updates a row in their yard',
    format('UPDATE public.container_port_data SET port_arrival_date = current_date - 6 WHERE container_number = %L AND yard_id = %L', _p2, _yard_a), 1);

  -- …and nothing outside it.
  PERFORM pg_temp.expect_refused('operator adds a row to another yard',
    pg_temp.add_row('QZPX' || _digits, _l1, _yard_b));
  PERFORM pg_temp.expect_refused('operator upserts into another yard',
    pg_temp.upsert_row(_pb, _l1, _yard_b, 30));
  PERFORM pg_temp.expect_refused('operator updates another yard''s row',
    format('UPDATE public.container_port_data SET free_days = 30 WHERE container_number = %L', _pb));
  PERFORM pg_temp.expect_refused('operator moves their yard''s row to another yard',
    format('UPDATE public.container_port_data SET yard_id = %L WHERE container_number = %L AND yard_id = %L', _yard_b, _p1, _yard_a));
  PERFORM pg_temp.expect_refused('operator deletes a row in their yard (delete stays with admins)',
    format('DELETE FROM public.container_port_data WHERE container_number = %L', _p2));

  PERFORM pg_temp.act_as_postgres();
  SELECT free_days INTO _free FROM public.container_port_data WHERE container_number = _p1 AND yard_id = _yard_a;
  IF _free IS DISTINCT FROM 21 THEN
    RAISE EXCEPTION 'FAIL the operator''s upsert did not land: free days %', _free;
  END IF;
  SELECT free_days INTO _free FROM public.container_port_data WHERE container_number = _pb;
  IF _free IS DISTINCT FROM 7 THEN
    RAISE EXCEPTION 'FAIL yard B''s row changed: free days %', _free;
  END IF;
  RAISE NOTICE 'ok: the writes landed where they should and nowhere else';

  -- ── 2. Other operators and accounts still can't write here ───────────────
  PERFORM pg_temp.act_as(_op_b);
  PERFORM pg_temp.expect_refused('yard B operator adds a row to yard A',
    pg_temp.add_row('QZPY' || _digits, _l1, _yard_a));
  PERFORM pg_temp.expect_refused('yard B operator updates yard A''s row',
    format('UPDATE public.container_port_data SET free_days = 30 WHERE container_number = %L', _p1));

  PERFORM pg_temp.act_as(_insp_a);
  PERFORM pg_temp.expect_refused('inspector adds a row in their yard',
    pg_temp.add_row('QZPZ' || _digits, _l1, _yard_a));
  PERFORM pg_temp.expect_refused('inspector updates a row in their yard',
    format('UPDATE public.container_port_data SET free_days = 30 WHERE container_number = %L', _p1));

  PERFORM pg_temp.act_as(_ro_a);
  PERFORM pg_temp.expect_refused('read-only admin adds a row',
    pg_temp.add_row('QZPR' || _digits, _l1, _yard_a));

  PERFORM pg_temp.act_as(_op_v);
  PERFORM pg_temp.expect_refused('car-lot operator adds a row in their yard',
    pg_temp.add_row('QZPV' || _digits, _l1, _yard_v));

  PERFORM pg_temp.act_as(_loner);
  PERFORM pg_temp.expect_refused('no-yard user adds a row to yard A',
    pg_temp.add_row('QZPQ' || _digits, _l1, _yard_a));

  -- ── 3. Unchanged: line rep, admin, super admin ───────────────────────────
  PERFORM pg_temp.act_as(_rep_a);
  PERFORM pg_temp.expect_written('line rep adds a row for their line',
    pg_temp.add_row('QZPS' || _digits, _l1, _yard_a), 1);
  PERFORM pg_temp.expect_refused('line rep adds a row for another line',
    pg_temp.add_row('QZPT' || _digits, _l2, _yard_a));
  PERFORM pg_temp.expect_refused('line rep updates another line''s row',
    format('UPDATE public.container_port_data SET free_days = 30 WHERE container_number = %L', _p2));

  PERFORM pg_temp.act_as(_admin_a);
  PERFORM pg_temp.expect_written('admin adds a row in their yard',
    pg_temp.add_row('QZPD' || _digits, _l2, _yard_a), 1);
  PERFORM pg_temp.expect_written('admin deletes a row in their yard',
    format('DELETE FROM public.container_port_data WHERE container_number = %L', _p2), 1);

  PERFORM pg_temp.act_as(_super);
  PERFORM pg_temp.expect_written('super admin adds a row to another yard',
    pg_temp.add_row('QZPU' || _digits, _l1, _yard_b), 1);

  PERFORM pg_temp.act_as_postgres();
  RAISE NOTICE 'operators port data: all checks passed';
END
$check$;

ROLLBACK;
