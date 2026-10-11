-- Lock down the SECURITY DEFINER functions the security advisor flags (lint
-- 0029: any signed-in user could call them through /rest/v1/rpc/*).
--
-- RLS helpers. has_role, is_super_admin, is_yard_admin, is_line_rep and
-- rep_shipping_line answer for whatever user id they are given, so through the
-- API a signed-in user could find out who the admins are and which line every
-- rep works for. current_yard_id, line_scope_ok, is_month_closed,
-- transfer_receipt_in_use and has_approved_inspection_for_trip leak less but
-- have no business on the API either. All ten move to a new `private` schema,
-- which the Data API does not expose. Policies point at functions by OID, so
-- every RLS policy (tables and storage) keeps working untouched;
-- `authenticated` keeps EXECUTE because policies run as the caller. Function
-- bodies refer to the helpers by name, so every function that calls one is
-- re-created below calling private.* instead.
--
-- The photo Worker (worker/index.ts) and the create-user /
-- reset-user-password Edge Functions called is_super_admin, is_yard_admin and
-- has_role over REST. They now read user_roles and profiles directly, and must
-- be deployed before this migration runs.
--
-- RPCs the app calls with supabase.rpc() keep EXECUTE for `authenticated`:
-- admin_edit_booking, admin_edit_container, close_accounting_month,
-- edit_shipping_line_transfer, increment_gated_out_containers,
-- record_cash_count, record_shipping_line_transfer, recount_cash,
-- reopen_accounting_month, void_demurrage_payment, void_shipping_line_transfer.
-- Each already checked the caller's role and the row's yard before writing.
-- The gaps closed here:
--   * increment_gated_out_containers checked the yard but not the role, so a
--     line rep or inspector could raise any booking's count in their yard.
--     Now gate staff and admins only.
--   * record_cash_count turned away line reps and inspectors by name, so an
--     account with no role could still count a drawer. Now an allow-list.
--   * admin_edit_container and rename_container let a yard admin renumber,
--     re-line or re-type a container that also has records in another yard,
--     which rewrote that yard's inspections, port data, payments and log.
--     Now only a super admin can do that.
--   * rename_container is no longer called by the app (admin_edit_container
--     renames), so signed-in users lose EXECUTE on it.
-- PUBLIC and anon lose EXECUTE on all of them.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- ── Helpers move out of the API ─────────────────────────────────────────────

ALTER FUNCTION public.has_role(uuid, public.app_role)                   SET SCHEMA private;
ALTER FUNCTION public.is_super_admin(uuid)                              SET SCHEMA private;
ALTER FUNCTION public.is_yard_admin(uuid, uuid)                         SET SCHEMA private;
ALTER FUNCTION public.current_yard_id()                                 SET SCHEMA private;
ALTER FUNCTION public.line_scope_ok(text)                               SET SCHEMA private;
ALTER FUNCTION public.is_line_rep(uuid)                                 SET SCHEMA private;
ALTER FUNCTION public.rep_shipping_line(uuid)                           SET SCHEMA private;
ALTER FUNCTION public.is_month_closed(uuid, timestamptz)                SET SCHEMA private;
ALTER FUNCTION public.transfer_receipt_in_use(text)                     SET SCHEMA private;
ALTER FUNCTION public.has_approved_inspection_for_trip(uuid)            SET SCHEMA private;

CREATE OR REPLACE FUNCTION private.line_scope_ok(_line text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT NOT private.is_line_rep(auth.uid())
         OR (_line IS NOT NULL
             AND lower(_line) = lower(private.rep_shipping_line(auth.uid())));
$function$;

-- True when the container, or anything filed under its number, belongs to a
-- yard other than _yard. Rows with no yard (old inspections) don't count.
-- Only called from the SECURITY DEFINER functions below, so it runs as their
-- owner and sees every yard.
CREATE OR REPLACE FUNCTION private.container_in_other_yards(_container_id uuid, _number text, _yard uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.container_visits    WHERE container_id = _container_id AND yard_id <> _yard)
      OR EXISTS (SELECT 1 FROM public.inspector_checks    WHERE container_number = _number AND yard_id <> _yard)
      OR EXISTS (SELECT 1 FROM public.container_port_data WHERE container_number = _number AND yard_id <> _yard)
      OR EXISTS (SELECT 1 FROM public.demurrage_payments  WHERE container_number = _number AND yard_id <> _yard)
      OR EXISTS (SELECT 1 FROM public.edi_transmissions   WHERE container_number = _number AND yard_id <> _yard)
      OR EXISTS (SELECT 1 FROM public.activity_log        WHERE container_number = _number AND yard_id <> _yard);
$function$;

-- ── RPCs the app calls ──────────────────────────────────────────────────────
-- Bodies as they stand in production, with helper calls pointed at private.*.
-- increment_gated_out_containers, record_cash_count and admin_edit_container
-- also gain the role and yard checks described at the top.

CREATE OR REPLACE FUNCTION public.admin_edit_booking(_booking_id uuid, _changes jsonb, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _b       public.bookings%ROWTYPE;
  _key     text;
  _log     jsonb := '[]'::jsonb;
  _txt     text;
  _int     integer;
BEGIN
  IF length(btrim(coalesce(_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'A reason is required for every correction.' USING ERRCODE = 'check_violation';
  END IF;
  IF _changes IS NULL OR jsonb_typeof(_changes) <> 'object' OR _changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'Nothing to change.' USING ERRCODE = 'check_violation';
  END IF;
  FOR _key IN SELECT jsonb_object_keys(_changes) LOOP
    IF NOT _key = ANY (ARRAY['customer_name', 'booking_number', 'shipping_line', 'total_containers', 'status']) THEN
      RAISE EXCEPTION '"%" cannot be edited here.', _key USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  SELECT * INTO _b FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT (private.is_super_admin(auth.uid()) OR private.is_yard_admin(auth.uid(), _b.yard_id)) THEN
    RAISE EXCEPTION 'Only a yard admin can edit bookings.' USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF _changes ? 'customer_name' THEN
    _txt := public.clean_text(_changes -> 'customer_name');
    IF _txt IS NULL THEN
      RAISE EXCEPTION 'The customer name cannot be blank.' USING ERRCODE = 'check_violation';
    END IF;
    IF _txt IS DISTINCT FROM _b.customer_name THEN
      _log := _log || jsonb_build_object('field', 'customer_name', 'from', _b.customer_name, 'to', _txt);
      UPDATE public.bookings SET customer_name = _txt, updated_at = now() WHERE id = _b.id;
    END IF;
  END IF;

  IF _changes ? 'booking_number' THEN
    _txt := public.clean_text(_changes -> 'booking_number');
    IF _txt IS NULL THEN
      RAISE EXCEPTION 'The booking number cannot be blank.' USING ERRCODE = 'check_violation';
    END IF;
    IF _txt IS DISTINCT FROM _b.booking_number THEN
      IF EXISTS (SELECT 1 FROM public.bookings WHERE booking_number = _txt AND id <> _b.id) THEN
        RAISE EXCEPTION 'Booking % already exists.', _txt USING ERRCODE = 'unique_violation';
      END IF;
      _log := _log || jsonb_build_object('field', 'booking_number', 'from', _b.booking_number, 'to', _txt);
      UPDATE public.bookings SET booking_number = _txt, updated_at = now() WHERE id = _b.id;
      UPDATE public.container_visits SET booking_number = _txt, updated_at = now()
       WHERE booking_id = _b.id OR (booking_id IS NULL AND booking_number = _b.booking_number AND yard_id = _b.yard_id);
      _b.booking_number := _txt;
    END IF;
  END IF;

  IF _changes ? 'shipping_line' THEN
    _txt := public.clean_text(_changes -> 'shipping_line');
    IF _txt IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.shipping_lines WHERE code = _txt) THEN
      RAISE EXCEPTION 'Unknown shipping line "%".', _txt USING ERRCODE = 'check_violation';
    END IF;
    IF _txt IS DISTINCT FROM _b.shipping_line THEN
      _log := _log || jsonb_build_object('field', 'shipping_line', 'from', _b.shipping_line, 'to', _txt);
      UPDATE public.bookings SET shipping_line = _txt, updated_at = now() WHERE id = _b.id;
    END IF;
  END IF;

  IF _changes ? 'total_containers' THEN
    _int := (_changes ->> 'total_containers')::integer;
    IF _int IS NULL OR _int < 1 OR _int < _b.gated_out_containers THEN
      RAISE EXCEPTION 'The container count must be at least 1 and at least the % already gated out.',
        _b.gated_out_containers USING ERRCODE = 'check_violation';
    END IF;
    IF _int IS DISTINCT FROM _b.total_containers THEN
      _log := _log || jsonb_build_object('field', 'total_containers', 'from', _b.total_containers, 'to', _int);
      UPDATE public.bookings SET total_containers = _int, updated_at = now() WHERE id = _b.id;
    END IF;
  END IF;

  IF _changes ? 'status' THEN
    _txt := lower(public.clean_text(_changes -> 'status'));
    IF _txt IS NULL OR _txt NOT IN ('active', 'completed', 'cancelled') THEN
      RAISE EXCEPTION 'Status must be active, completed or cancelled.' USING ERRCODE = 'check_violation';
    END IF;
    IF _txt IS DISTINCT FROM _b.status THEN
      _log := _log || jsonb_build_object('field', 'status', 'from', _b.status, 'to', _txt);
      UPDATE public.bookings SET status = _txt, updated_at = now() WHERE id = _b.id;
    END IF;
  END IF;

  IF jsonb_array_length(_log) = 0 THEN
    RAISE EXCEPTION 'Nothing changed — every value is already what you entered.' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.activity_log (user_id, yard_id, action, container_id, container_number, shift, occurred_at, metadata)
  VALUES (auth.uid(), _b.yard_id, 'booking_edited', NULL, NULL, public.current_work_shift(), now(),
          jsonb_build_object('changes', _log, 'reason', btrim(_reason),
                             'booking_id', _b.id, 'booking_number', _b.booking_number));

  RETURN _log;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.admin_edit_container(_visit_id uuid, _changes jsonb, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _visit    public.container_visits%ROWTYPE;
  _cont     public.containers%ROWTYPE;
  _key      text;
  _log      jsonb := '[]'::jsonb;
  _allowed  text[] := ARRAY[
    -- the container itself
    'container_number', 'shipping_line', 'container_type',
    -- this visit, gate-in side
    'driver_name', 'truck_number', 'gate_in_time', 'yard_block', 'yard_row',
    -- this visit, gate-out side
    'gate_out_driver_name', 'gate_out_truck_number', 'gate_out_time', 'seal_number', 'fees',
    -- this visit's demurrage snapshot, taken from the port list at gate-in
    'port_arrival_date', 'free_days'
  ];
  _new_number text;
  _new_line   text;
  _new_type   text;
  _txt        text;
  _ts         timestamptz;
  _num        numeric;
  _clash      record;
  _date       date;
BEGIN
  IF length(btrim(coalesce(_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'A reason is required for every correction.' USING ERRCODE = 'check_violation';
  END IF;
  IF _changes IS NULL OR jsonb_typeof(_changes) <> 'object' OR _changes = '{}'::jsonb THEN
    RAISE EXCEPTION 'Nothing to change.' USING ERRCODE = 'check_violation';
  END IF;
  FOR _key IN SELECT jsonb_object_keys(_changes) LOOP
    IF NOT _key = ANY (_allowed) THEN
      RAISE EXCEPTION '"%" cannot be edited here.', _key USING ERRCODE = 'check_violation';
    END IF;
  END LOOP;

  SELECT * INTO _visit FROM public.container_visits WHERE id = _visit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Visit not found.' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT (private.is_super_admin(auth.uid()) OR private.is_yard_admin(auth.uid(), _visit.yard_id)) THEN
    RAISE EXCEPTION 'Only a yard admin can edit container records.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO _cont FROM public.containers WHERE id = _visit.container_id FOR UPDATE;

  -- The container row is shared by every yard the box has visited, and a new
  -- number is cascaded into the inspections, port data, payments and log of
  -- every yard. A yard admin may change it only when all of that is theirs.
  IF _changes ?| ARRAY['container_number', 'shipping_line', 'container_type']
     AND NOT private.is_super_admin(auth.uid())
     AND private.container_in_other_yards(_cont.id, _cont.container_number, _visit.yard_id) THEN
    RAISE EXCEPTION 'This container also has records in another yard. Ask a super admin to correct its number, line or type.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- ── the container ──────────────────────────────────────────────────────
  IF _changes ? 'container_number' THEN
    _new_number := upper(coalesce(public.clean_text(_changes -> 'container_number'), ''));
    IF _new_number !~ '^[A-Z]{4}[0-9]{7}$' THEN
      RAISE EXCEPTION 'Invalid container number "%". Expected 4 letters followed by 7 digits, e.g. MSKU1234567.', _new_number
        USING ERRCODE = 'check_violation';
    END IF;
    IF _new_number IS DISTINCT FROM _cont.container_number THEN
      SELECT c.id, (v.id IS NOT NULL) AS in_yard INTO _clash
        FROM public.containers c
        LEFT JOIN public.container_visits v ON v.container_id = c.id AND v.gate_out_time IS NULL
       WHERE c.container_number = _new_number
       LIMIT 1;
      IF FOUND THEN
        RAISE EXCEPTION '% already exists (%). Two records cannot share a number.', _new_number,
          CASE WHEN _clash.in_yard THEN 'in yard' ELSE 'gated out' END
          USING ERRCODE = 'unique_violation';
      END IF;
      IF EXISTS (SELECT 1 FROM public.container_port_data WHERE container_number = _cont.container_number)
         AND EXISTS (SELECT 1 FROM public.container_port_data WHERE container_number = _new_number) THEN
        RAISE EXCEPTION 'Port data exists under both % and %. Delete the wrong port record first.',
          _cont.container_number, _new_number USING ERRCODE = 'unique_violation';
      END IF;
      PERFORM public.cascade_container_number(_cont.id, _cont.container_number, _new_number);
      _log := _log || jsonb_build_object('field', 'container_number', 'from', _cont.container_number, 'to', _new_number);
      _cont.container_number := _new_number;
    END IF;
  END IF;

  IF _changes ? 'shipping_line' THEN
    _new_line := public.clean_text(_changes -> 'shipping_line');
    IF _new_line IS NULL OR NOT EXISTS (SELECT 1 FROM public.shipping_lines WHERE code = _new_line) THEN
      RAISE EXCEPTION 'Unknown shipping line "%".', coalesce(_new_line, '') USING ERRCODE = 'check_violation';
    END IF;
    IF _new_line IS DISTINCT FROM _cont.shipping_line THEN
      _log := _log || jsonb_build_object('field', 'shipping_line', 'from', _cont.shipping_line, 'to', _new_line);
      UPDATE public.containers SET shipping_line = _new_line, updated_at = now() WHERE id = _cont.id;
      -- Port data carries its own copy of the line for demurrage; keep it in step.
      UPDATE public.container_port_data SET shipping_line = _new_line, updated_at = now()
       WHERE container_number = _cont.container_number AND yard_id = _visit.yard_id;
    END IF;
  END IF;

  IF _changes ? 'container_type' THEN
    _new_type := upper(coalesce(public.clean_text(_changes -> 'container_type'), ''));
    IF _new_type !~ '^(20|40|45)(GP|HC|RF|RH|FR|OT|TK|FT)$' THEN
      RAISE EXCEPTION 'Unknown container type "%".', _new_type USING ERRCODE = 'check_violation';
    END IF;
    IF _new_type IS DISTINCT FROM _cont.container_type THEN
      _log := _log || jsonb_build_object('field', 'container_type', 'from', _cont.container_type, 'to', _new_type);
      UPDATE public.containers SET container_type = _new_type, updated_at = now() WHERE id = _cont.id;
      UPDATE public.container_port_data SET container_type = _new_type, updated_at = now()
       WHERE container_number = _cont.container_number AND yard_id = _visit.yard_id;
    END IF;
  END IF;

  -- ── the visit: free-text fields ────────────────────────────────────────
  FOREACH _key IN ARRAY ARRAY['driver_name', 'truck_number', 'yard_block', 'yard_row',
                              'gate_out_driver_name', 'gate_out_truck_number', 'seal_number'] LOOP
    CONTINUE WHEN NOT _changes ? _key;
    _txt := public.clean_text(_changes -> _key);
    IF _key IN ('truck_number', 'gate_out_truck_number', 'seal_number', 'yard_block', 'yard_row') THEN
      _txt := upper(_txt);
    END IF;
    IF _key IN ('driver_name', 'truck_number') AND _txt IS NULL THEN
      RAISE EXCEPTION 'The gate-in driver and truck cannot be blank.' USING ERRCODE = 'check_violation';
    END IF;
    IF _key IN ('gate_out_driver_name', 'gate_out_truck_number', 'seal_number')
       AND _visit.gate_out_time IS NULL AND _txt IS NOT NULL THEN
      RAISE EXCEPTION 'This container has not gated out, so it has no gate-out details to correct.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF _txt IS DISTINCT FROM (to_jsonb(_visit) ->> _key) THEN
      _log := _log || jsonb_build_object('field', _key, 'from', to_jsonb(_visit) ->> _key, 'to', _txt);
      EXECUTE format('UPDATE public.container_visits SET %I = $1, updated_at = now() WHERE id = $2', _key)
        USING _txt, _visit.id;
    END IF;
  END LOOP;

  -- ── the visit: times and fees ──────────────────────────────────────────
  IF _changes ? 'gate_in_time' THEN
    _ts := (_changes ->> 'gate_in_time')::timestamptz;
    IF _ts IS NULL OR _ts > now() THEN
      RAISE EXCEPTION 'The gate-in time must be set and cannot be in the future.' USING ERRCODE = 'check_violation';
    END IF;
    IF _visit.gate_out_time IS NOT NULL AND _ts >= _visit.gate_out_time
       AND NOT _changes ? 'gate_out_time' THEN
      RAISE EXCEPTION 'The gate-in time must be before the gate-out time.' USING ERRCODE = 'check_violation';
    END IF;
    IF _ts IS DISTINCT FROM _visit.gate_in_time THEN
      _log := _log || jsonb_build_object('field', 'gate_in_time', 'from', _visit.gate_in_time, 'to', _ts);
      UPDATE public.container_visits SET gate_in_time = _ts, updated_at = now() WHERE id = _visit.id;
      _visit.gate_in_time := _ts;
    END IF;
  END IF;

  IF _changes ? 'gate_out_time' THEN
    IF _visit.gate_out_time IS NULL THEN
      RAISE EXCEPTION 'This container has not gated out. Use Gate Out to release it.' USING ERRCODE = 'check_violation';
    END IF;
    _ts := (_changes ->> 'gate_out_time')::timestamptz;
    IF _ts IS NULL OR _ts > now() OR _ts <= _visit.gate_in_time THEN
      RAISE EXCEPTION 'The gate-out time must be after the gate-in time and not in the future.'
        USING ERRCODE = 'check_violation';
    END IF;
    IF _ts IS DISTINCT FROM _visit.gate_out_time THEN
      _log := _log || jsonb_build_object('field', 'gate_out_time', 'from', _visit.gate_out_time, 'to', _ts);
      UPDATE public.container_visits SET gate_out_time = _ts, updated_at = now() WHERE id = _visit.id;
    END IF;
  END IF;

  IF _changes ? 'fees' THEN
    IF _visit.gate_out_time IS NULL THEN
      RAISE EXCEPTION 'Gate-out fees can only be corrected after the container has gated out.'
        USING ERRCODE = 'check_violation';
    END IF;
    _num := round((_changes ->> 'fees')::numeric, 3);
    IF _num IS NULL OR _num < 0 THEN
      RAISE EXCEPTION 'Fees must be zero or more.' USING ERRCODE = 'check_violation';
    END IF;
    IF _num IS DISTINCT FROM _visit.fees THEN
      _log := _log || jsonb_build_object('field', 'fees', 'from', _visit.fees, 'to', _num);
      UPDATE public.container_visits SET fees = _num, updated_at = now() WHERE id = _visit.id;
    END IF;
  END IF;

  -- ── the visit: port arrival and free days ──────────────────────────────
  -- The trip's snapshot of the line's port list. Correcting it doesn't touch a
  -- payment already collected; the log keeps the before and after.
  IF _changes ? 'port_arrival_date' THEN
    _date := nullif(_changes ->> 'port_arrival_date', '')::date;
    IF _date IS NULL OR _date > (now() AT TIME ZONE 'Asia/Amman')::date THEN
      RAISE EXCEPTION 'The port arrival date must be set and cannot be in the future.' USING ERRCODE = 'check_violation';
    END IF;
    IF _date > (_visit.gate_in_time AT TIME ZONE 'Asia/Amman')::date THEN
      RAISE EXCEPTION 'The port arrival date cannot be after the gate-in date.' USING ERRCODE = 'check_violation';
    END IF;
    IF _date IS DISTINCT FROM _visit.port_arrival_date THEN
      _log := _log || jsonb_build_object('field', 'port_arrival_date', 'from', _visit.port_arrival_date, 'to', _date);
      UPDATE public.container_visits SET port_arrival_date = _date, updated_at = now() WHERE id = _visit.id;
    END IF;
  END IF;

  IF _changes ? 'free_days' THEN
    _num := (_changes ->> 'free_days')::numeric;
    IF _num IS NULL OR _num < 0 OR _num > 365 OR _num <> trunc(_num) THEN
      RAISE EXCEPTION 'Free days must be a whole number from 0 to 365.' USING ERRCODE = 'check_violation';
    END IF;
    IF _num::int IS DISTINCT FROM _visit.free_days THEN
      _log := _log || jsonb_build_object('field', 'free_days', 'from', _visit.free_days, 'to', _num::int);
      UPDATE public.container_visits SET free_days = _num::int, updated_at = now() WHERE id = _visit.id;
    END IF;
  END IF;

  IF jsonb_array_length(_log) = 0 THEN
    RAISE EXCEPTION 'Nothing changed — every value is already what you entered.' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.activity_log (user_id, yard_id, action, container_id, container_number, shift, occurred_at, metadata)
  VALUES (auth.uid(), _visit.yard_id, 'container_edited', _visit.id, _cont.container_number,
          public.current_work_shift(), now(),
          jsonb_build_object('changes', _log, 'reason', btrim(_reason), 'visit_id', _visit.id));

  RETURN _log;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.close_accounting_month(_yard_id uuid, _month date, _notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _m       date := date_trunc('month', _month)::date;
  _start   timestamptz;
  _end     timestamptz;
  _summary jsonb;
  _id      uuid;
BEGIN
  IF auth.uid() IS NULL
     OR NOT (private.is_super_admin(auth.uid()) OR private.is_yard_admin(auth.uid(), _yard_id)) THEN
    RAISE EXCEPTION 'Only a yard admin can close a month' USING ERRCODE = '42501';
  END IF;
  IF (_m + interval '1 month')::date > (now() AT TIME ZONE 'Asia/Amman')::date THEN
    RAISE EXCEPTION '% has not ended yet', to_char(_m, 'FMMonth YYYY');
  END IF;
  IF EXISTS (SELECT 1 FROM public.accounting_month_closes
              WHERE yard_id = _yard_id AND month = _m AND reopened_at IS NULL) THEN
    RAISE EXCEPTION '% is already closed', to_char(_m, 'FMMonth YYYY');
  END IF;

  _start := _m::timestamp AT TIME ZONE 'Asia/Amman';
  _end   := (_m + interval '1 month')::timestamp AT TIME ZONE 'Asia/Amman';

  WITH p AS (
    SELECT * FROM public.demurrage_payments WHERE yard_id = _yard_id AND voided_at IS NULL
  ), t AS (
    SELECT * FROM public.shipping_line_transfers WHERE yard_id = _yard_id AND voided_at IS NULL
  ), lines AS (
    SELECT shipping_line FROM p WHERE created_at < _end
    UNION SELECT shipping_line FROM t WHERE transferred_at < _end
  ), per_line AS (
    SELECT l.shipping_line,
           coalesce((SELECT sum(demurrage_amount) FROM p WHERE p.shipping_line = l.shipping_line AND created_at < _start), 0)
         - coalesce((SELECT sum(amount_transferred) FROM t WHERE t.shipping_line = l.shipping_line AND transferred_at < _start), 0) AS opening,
           coalesce((SELECT sum(demurrage_amount) FROM p WHERE p.shipping_line = l.shipping_line AND created_at >= _start AND created_at < _end), 0) AS collected,
           coalesce((SELECT sum(amount_transferred) FROM t WHERE t.shipping_line = l.shipping_line AND transferred_at >= _start AND transferred_at < _end), 0) AS transferred
      FROM lines l
  )
  SELECT jsonb_build_object(
    'payments',       (SELECT count(*) FROM p WHERE created_at >= _start AND created_at < _end),
    'total_collected',(SELECT coalesce(sum(total_collected), 0) FROM p WHERE created_at >= _start AND created_at < _end),
    'demurrage',      (SELECT coalesce(sum(demurrage_amount), 0) FROM p WHERE created_at >= _start AND created_at < _end),
    'service_fees',   (SELECT coalesce(sum(service_fee), 0) FROM p WHERE created_at >= _start AND created_at < _end),
    'by_method',      (SELECT coalesce(jsonb_object_agg(payment_method, s), '{}'::jsonb) FROM
                         (SELECT payment_method, sum(total_collected) s FROM p
                           WHERE created_at >= _start AND created_at < _end GROUP BY payment_method) x),
    'voided',         (SELECT count(*) FROM public.demurrage_payments
                        WHERE yard_id = _yard_id AND voided_at IS NOT NULL AND created_at >= _start AND created_at < _end),
    'transfers',      (SELECT count(*) FROM t WHERE transferred_at >= _start AND transferred_at < _end),
    'transferred',    (SELECT coalesce(sum(amount_transferred), 0) FROM t WHERE transferred_at >= _start AND transferred_at < _end),
    'lines',          (SELECT coalesce(jsonb_agg(jsonb_build_object(
                          'shipping_line', shipping_line, 'opening', opening, 'collected', collected,
                          'transferred', transferred, 'closing', opening + collected - transferred)
                          ORDER BY shipping_line), '[]'::jsonb) FROM per_line)
  ) INTO _summary;

  INSERT INTO public.accounting_month_closes (yard_id, month, closed_by, notes, summary)
  VALUES (_yard_id, _m, auth.uid(), nullif(btrim(_notes), ''), _summary)
  RETURNING id INTO _id;

  INSERT INTO public.activity_log (user_id, yard_id, action, container_id, container_number, shift, occurred_at, metadata)
  VALUES (auth.uid(), _yard_id, 'month_closed', NULL, NULL, public.current_work_shift(), now(),
          jsonb_build_object('close_id', _id, 'month', _m, 'total_collected', _summary->'total_collected',
                             'notes', nullif(btrim(_notes), '')));

  RETURN jsonb_build_object('close_id', _id, 'summary', _summary);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.edit_shipping_line_transfer(_transfer_id uuid, _reference text, _notes text, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _t public.shipping_line_transfers%ROWTYPE;
  _changes jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO _t FROM public.shipping_line_transfers WHERE id = _transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer not found';
  END IF;
  IF auth.uid() IS NULL
     OR NOT (private.is_super_admin(auth.uid()) OR private.is_yard_admin(auth.uid(), _t.yard_id)) THEN
    RAISE EXCEPTION 'Only a yard admin can edit a transfer' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;
  IF _t.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'This transfer was voided and can no longer be edited';
  END IF;

  IF _t.reference IS DISTINCT FROM nullif(btrim(_reference), '') THEN
    _changes := _changes || jsonb_build_object('field', 'reference', 'from', _t.reference, 'to', nullif(btrim(_reference), ''));
  END IF;
  IF _t.notes IS DISTINCT FROM nullif(btrim(_notes), '') THEN
    _changes := _changes || jsonb_build_object('field', 'notes', 'from', _t.notes, 'to', nullif(btrim(_notes), ''));
  END IF;
  IF jsonb_array_length(_changes) = 0 THEN
    RETURN;
  END IF;

  UPDATE public.shipping_line_transfers
     SET reference = nullif(btrim(_reference), ''), notes = nullif(btrim(_notes), '')
   WHERE id = _transfer_id;

  INSERT INTO public.activity_log (user_id, yard_id, action, container_id, container_number, shift, occurred_at, metadata)
  VALUES (auth.uid(), _t.yard_id, 'transfer_edited', NULL, NULL, public.current_work_shift(), now(),
          jsonb_build_object('transfer_id', _t.id, 'shipping_line', _t.shipping_line,
                             'changes', _changes, 'reason', btrim(_reason)));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.increment_gated_out_containers(booking_num text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Gate staff and admins release containers. Line reps and inspectors don't
  -- (Gate Out isn't in their menus), so they can't move a booking's count.
  IF auth.uid() IS NULL
     OR private.is_line_rep(auth.uid())
     OR NOT (private.is_super_admin(auth.uid())
             OR private.has_role(auth.uid(), 'admin')
             OR private.has_role(auth.uid(), 'user')) THEN
    RAISE EXCEPTION 'Only gate staff and admins can update a booking''s gate-out count'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.bookings
  SET gated_out_containers = gated_out_containers + 1,
      updated_at = now()
  WHERE booking_number = booking_num
    AND (
      private.is_super_admin(auth.uid())
      OR yard_id = private.current_yard_id()
    );
END;
$function$
;

CREATE OR REPLACE FUNCTION public.record_cash_count(_shift_date date, _shift work_shift, _counted numeric, _notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _yard     uuid := private.current_yard_id();
  _window   tstzrange := public.shift_window(_shift_date, _shift);
  _expected numeric;
  _count    integer;
  _id       uuid;
BEGIN
  IF auth.uid() IS NULL OR _yard IS NULL THEN
    RAISE EXCEPTION 'Your account has no yard' USING ERRCODE = '42501';
  END IF;
  -- An allow-list: gate staff and admins. Line reps, inspectors and an
  -- account with no role at all are turned away.
  IF private.is_line_rep(auth.uid())
     OR NOT (private.is_super_admin(auth.uid())
             OR private.has_role(auth.uid(), 'admin')
             OR private.has_role(auth.uid(), 'user')) THEN
    RAISE EXCEPTION 'Only gate staff and admins record cash counts' USING ERRCODE = '42501';
  END IF;
  IF _counted IS NULL OR _counted < 0 THEN
    RAISE EXCEPTION 'Enter the cash counted (zero or more)';
  END IF;
  IF lower(_window) > now() THEN
    RAISE EXCEPTION 'That shift has not started yet';
  END IF;

  SELECT coalesce(sum(total_collected), 0), count(*)
    INTO _expected, _count
    FROM public.demurrage_payments
   WHERE yard_id = _yard
     AND payment_method = 'cash'
     AND voided_at IS NULL
     AND created_at <@ _window;

  BEGIN
    INSERT INTO public.cash_counts (yard_id, shift_date, shift, counted_cash, expected_cash, payment_count, counted_by, notes)
    VALUES (_yard, _shift_date, _shift, round(_counted, 3), _expected, _count, auth.uid(), nullif(btrim(_notes), ''))
    RETURNING id INTO _id;
  EXCEPTION WHEN unique_violation THEN
    RAISE EXCEPTION 'This shift''s drawer was already counted';
  END;

  -- The expected amount stays out of the log: gate staff can read the log,
  -- and the count is meant to be blind.
  INSERT INTO public.activity_log (user_id, yard_id, action, container_id, container_number, shift, occurred_at, metadata)
  VALUES (auth.uid(), _yard, 'cash_counted', NULL, NULL, public.current_work_shift(), now(),
          jsonb_build_object('cash_count_id', _id, 'shift_date', _shift_date, 'shift', _shift,
                             'counted_jod', round(_counted, 3)));

  RETURN _id;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.record_shipping_line_transfer(_yard_id uuid, _shipping_line text, _payment_ids uuid[], _receipt_path text, _reference text DEFAULT NULL::text, _notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _ids      uuid[];
  _found    integer;
  _amount   numeric;
  _transfer uuid;
  _path     text := btrim(_receipt_path);
BEGIN
  IF auth.uid() IS NULL
     OR NOT (private.is_super_admin(auth.uid()) OR private.is_yard_admin(auth.uid(), _yard_id)) THEN
    RAISE EXCEPTION 'Only a yard admin can record a transfer' USING ERRCODE = '42501';
  END IF;

  IF nullif(_path, '') IS NULL THEN
    RAISE EXCEPTION 'A transfer receipt is required';
  END IF;
  IF left(_path, length(_yard_id::text) + 1) <> _yard_id::text || '/'
     OR NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'transfer-receipts' AND name = _path) THEN
    RAISE EXCEPTION 'The receipt upload was not found — upload it again';
  END IF;
  IF private.transfer_receipt_in_use(_path) THEN
    RAISE EXCEPTION 'That receipt is already attached to another transfer';
  END IF;

  SELECT coalesce(array_agg(DISTINCT id), '{}') INTO _ids FROM unnest(_payment_ids) AS id;
  IF cardinality(_ids) = 0 THEN
    RAISE EXCEPTION 'No payments selected';
  END IF;

  -- Lock first so a concurrent settlement waits and then sees them transferred.
  PERFORM 1 FROM public.demurrage_payments WHERE id = ANY(_ids) FOR UPDATE;

  SELECT count(*), coalesce(sum(demurrage_amount), 0)
    INTO _found, _amount
    FROM public.demurrage_payments
   WHERE id = ANY(_ids)
     AND yard_id = _yard_id
     AND shipping_line = _shipping_line
     AND NOT transferred
     AND voided_at IS NULL;

  IF _found <> cardinality(_ids) THEN
    RAISE EXCEPTION 'Some payments are already transferred, voided, or belong to another line or yard — refresh and try again';
  END IF;
  IF _amount <= 0 THEN
    RAISE EXCEPTION 'Nothing is owed to % for these payments', _shipping_line;
  END IF;

  INSERT INTO public.shipping_line_transfers
    (shipping_line, amount_transferred, transferred_by, receipt_url, yard_id, reference, notes, payment_count)
  VALUES
    (_shipping_line, _amount, auth.uid(), _path, _yard_id,
     nullif(btrim(_reference), ''), nullif(btrim(_notes), ''), _found)
  RETURNING id INTO _transfer;

  UPDATE public.demurrage_payments
     SET transferred = true, transfer_id = _transfer
   WHERE id = ANY(_ids);

  INSERT INTO public.activity_log (user_id, yard_id, action, container_id, container_number, shift, occurred_at, metadata)
  VALUES (auth.uid(), _yard_id, 'demurrage_transferred', NULL, NULL, public.current_work_shift(), now(),
          jsonb_build_object('transfer_id', _transfer, 'shipping_line', _shipping_line,
                             'amount_jod', _amount, 'payment_count', _found,
                             'reference', nullif(btrim(_reference), '')));

  RETURN jsonb_build_object('transfer_id', _transfer, 'amount', _amount, 'payment_count', _found);
END;
$function$
;

CREATE OR REPLACE FUNCTION public.recount_cash(_cash_count_id uuid, _counted numeric, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _c        public.cash_counts%ROWTYPE;
  _expected numeric;
  _count    integer;
BEGIN
  SELECT * INTO _c FROM public.cash_counts WHERE id = _cash_count_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cash count not found';
  END IF;
  IF auth.uid() IS NULL
     OR NOT (private.is_super_admin(auth.uid()) OR private.is_yard_admin(auth.uid(), _c.yard_id)) THEN
    RAISE EXCEPTION 'Only a yard admin can record a recount' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;
  IF _counted IS NULL OR _counted < 0 THEN
    RAISE EXCEPTION 'Enter the cash counted (zero or more)';
  END IF;

  SELECT coalesce(sum(total_collected), 0), count(*)
    INTO _expected, _count
    FROM public.demurrage_payments
   WHERE yard_id = _c.yard_id
     AND payment_method = 'cash'
     AND voided_at IS NULL
     AND created_at <@ public.shift_window(_c.shift_date, _c.shift);

  UPDATE public.cash_counts
     SET original_counted_cash = coalesce(original_counted_cash, counted_cash),
         counted_cash   = round(_counted, 3),
         expected_cash  = _expected,
         payment_count  = _count,
         recounted_at   = now(),
         recounted_by   = auth.uid(),
         recount_reason = btrim(_reason)
   WHERE id = _cash_count_id;

  -- As with the first count, the expected amount stays out of the log.
  INSERT INTO public.activity_log (user_id, yard_id, action, container_id, container_number, shift, occurred_at, metadata)
  VALUES (auth.uid(), _c.yard_id, 'cash_recounted', NULL, NULL, public.current_work_shift(), now(),
          jsonb_build_object('cash_count_id', _c.id, 'shift_date', _c.shift_date, 'shift', _c.shift,
                             'from_jod', _c.counted_cash, 'to_jod', round(_counted, 3),
                             'reason', btrim(_reason)));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.reopen_accounting_month(_close_id uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _c public.accounting_month_closes%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT private.is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'Only a super admin can reopen a closed month' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;
  SELECT * INTO _c FROM public.accounting_month_closes WHERE id = _close_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Month close not found';
  END IF;
  IF _c.reopened_at IS NOT NULL THEN
    RAISE EXCEPTION 'This month is already reopened';
  END IF;

  UPDATE public.accounting_month_closes
     SET reopened_at = now(), reopened_by = auth.uid(), reopen_reason = btrim(_reason)
   WHERE id = _close_id;

  INSERT INTO public.activity_log (user_id, yard_id, action, container_id, container_number, shift, occurred_at, metadata)
  VALUES (auth.uid(), _c.yard_id, 'month_reopened', NULL, NULL, public.current_work_shift(), now(),
          jsonb_build_object('close_id', _c.id, 'month', _c.month, 'reason', btrim(_reason)));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.void_demurrage_payment(_payment_id uuid, _reason text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _p public.demurrage_payments%ROWTYPE;
BEGIN
  SELECT * INTO _p FROM public.demurrage_payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;
  IF auth.uid() IS NULL
     OR NOT (private.is_super_admin(auth.uid()) OR private.is_yard_admin(auth.uid(), _p.yard_id)) THEN
    RAISE EXCEPTION 'Only a yard admin can void a payment' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;
  IF _p.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'This payment is already voided';
  END IF;
  IF _p.transferred THEN
    RAISE EXCEPTION 'This payment was already transferred to %. Void that transfer first.', _p.shipping_line;
  END IF;

  UPDATE public.demurrage_payments
     SET voided_at = now(), voided_by = auth.uid(), void_reason = btrim(_reason)
   WHERE id = _payment_id;

  INSERT INTO public.activity_log (user_id, yard_id, action, container_id, container_number, shift, occurred_at, metadata)
  VALUES (auth.uid(), _p.yard_id, 'payment_voided', NULL, _p.container_number, public.current_work_shift(), now(),
          jsonb_build_object('payment_id', _p.id, 'shipping_line', _p.shipping_line,
                             'total_jod', _p.total_collected, 'payment_method', _p.payment_method,
                             'collected_at', _p.created_at, 'reason', btrim(_reason)));
END;
$function$
;

CREATE OR REPLACE FUNCTION public.void_shipping_line_transfer(_transfer_id uuid, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _t   public.shipping_line_transfers%ROWTYPE;
  _ids uuid[];
BEGIN
  SELECT * INTO _t FROM public.shipping_line_transfers WHERE id = _transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer not found';
  END IF;
  IF auth.uid() IS NULL
     OR NOT (private.is_super_admin(auth.uid()) OR private.is_yard_admin(auth.uid(), _t.yard_id)) THEN
    RAISE EXCEPTION 'Only a yard admin can void a transfer' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(_reason), '') IS NULL THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;
  IF _t.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'This transfer is already voided';
  END IF;

  -- Its payments go back to pending, so they can be settled again correctly.
  WITH freed AS (
    UPDATE public.demurrage_payments
       SET transferred = false, transfer_id = NULL
     WHERE transfer_id = _transfer_id
    RETURNING id
  )
  SELECT coalesce(array_agg(id), '{}') INTO _ids FROM freed;

  UPDATE public.shipping_line_transfers
     SET voided_at = now(), voided_by = auth.uid(), void_reason = btrim(_reason)
   WHERE id = _transfer_id;

  INSERT INTO public.activity_log (user_id, yard_id, action, container_id, container_number, shift, occurred_at, metadata)
  VALUES (auth.uid(), _t.yard_id, 'transfer_voided', NULL, NULL, public.current_work_shift(), now(),
          jsonb_build_object('transfer_id', _t.id, 'shipping_line', _t.shipping_line,
                             'amount_jod', _t.amount_transferred, 'reference', _t.reference,
                             'payment_ids', to_jsonb(_ids), 'reason', btrim(_reason)));

  RETURN jsonb_build_object('transfer_id', _t.id, 'payments_released', cardinality(_ids));
END;
$function$
;

-- ── Not called by the app ───────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rename_container(_container_id uuid, _new_number text, _reason text DEFAULT NULL::text)
 RETURNS TABLE(old_number text, new_number text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _old        text;
  _new        text;
  _yard       uuid;
  _clash      record;
  _clash_desc text;
BEGIN
  _new := upper(btrim(coalesce(_new_number, '')));

  IF _new !~ '^[A-Z]{4}[0-9]{7}$' THEN
    RAISE EXCEPTION 'Invalid container number "%". Expected 4 letters followed by 7 digits, e.g. MSKU1234567.', _new
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT container_number INTO _old FROM public.containers WHERE id = _container_id;
  IF _old IS NULL THEN
    RAISE EXCEPTION 'Container not found.' USING ERRCODE = 'no_data_found';
  END IF;

  IF _old = _new THEN
    RAISE EXCEPTION 'The container is already numbered %.', _new USING ERRCODE = 'check_violation';
  END IF;

  SELECT yard_id INTO _yard
    FROM public.container_visits
   WHERE container_id = _container_id AND gate_out_time IS NULL
   LIMIT 1;
  IF _yard IS NULL THEN
    RAISE EXCEPTION 'Only a container currently in the yard can be renamed. % has no open visit.', _old
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT (private.is_super_admin(auth.uid()) OR private.is_yard_admin(auth.uid(), _yard)) THEN
    RAISE EXCEPTION 'Only a yard admin can correct a container number.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT private.is_super_admin(auth.uid())
     AND private.container_in_other_yards(_container_id, _old, _yard) THEN
    RAISE EXCEPTION 'This container also has records in another yard. Ask a super admin to correct its number.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  SELECT c.id,
         (v.id IS NOT NULL) AS in_yard,
         v.yard_block, v.yard_row
    INTO _clash
    FROM public.containers c
    LEFT JOIN public.container_visits v
           ON v.container_id = c.id AND v.gate_out_time IS NULL
   WHERE c.container_number = _new
   LIMIT 1;

  IF FOUND THEN
    _clash_desc := CASE
      WHEN _clash.in_yard AND _clash.yard_block IS NOT NULL
        THEN format('in yard, block %s-%s', _clash.yard_block, _clash.yard_row)
      WHEN _clash.in_yard THEN 'in yard'
      ELSE 'gated out'
    END;
    RAISE EXCEPTION
      '% already exists (%). Cancel one of the two gate-ins instead of renaming.', _new, _clash_desc
      USING ERRCODE = 'unique_violation';
  END IF;

  IF EXISTS (SELECT 1 FROM public.container_port_data WHERE container_number = _old)
     AND EXISTS (SELECT 1 FROM public.container_port_data WHERE container_number = _new)
  THEN
    RAISE EXCEPTION
      'Port data exists under both % and %. Delete the wrong port record first, then rename.', _old, _new
      USING ERRCODE = 'unique_violation';
  END IF;

  UPDATE public.inspector_checks     SET container_number = _new WHERE container_number = _old;
  UPDATE public.container_port_data  SET container_number = _new WHERE container_number = _old;
  UPDATE public.demurrage_payments   SET container_number = _new WHERE container_number = _old;
  UPDATE public.container_demurrage  SET container_number = _new WHERE container_number = _old;
  UPDATE public.edi_transmissions    SET container_number = _new WHERE container_number = _old;
  UPDATE public.activity_log         SET container_number = _new WHERE container_number = _old;
  UPDATE public.containers           SET container_number = _new WHERE id = _container_id;

  INSERT INTO public.activity_log (user_id, yard_id, action, container_id, container_number, shift, occurred_at, metadata)
  VALUES (
    auth.uid(), _yard, 'container_renamed', _container_id, _new,
    CASE WHEN extract(hour FROM now() AT TIME ZONE 'Asia/Amman') >= 6
          AND extract(hour FROM now() AT TIME ZONE 'Asia/Amman') < 18
         THEN 'day'::public.work_shift ELSE 'night'::public.work_shift END,
    now(),
    jsonb_build_object('from', _old, 'to', _new, 'reason', _reason)
  );

  old_number := _old;
  new_number := _new;
  RETURN NEXT;
END;
$function$
;

-- ── Trigger functions ───────────────────────────────────────────────────────
-- Unchanged apart from the helper schema.

CREATE OR REPLACE FUNCTION public.containers_guard_number_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.container_number IS DISTINCT FROM OLD.container_number THEN
    IF NOT (private.is_super_admin(auth.uid())
            OR EXISTS (SELECT 1 FROM public.user_roles
                        WHERE user_id = auth.uid() AND role = 'admin'))
    THEN
      RAISE EXCEPTION 'Only a yard admin can change a container number.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.enforce_port_list_on_gate_in()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _pd   record;
  _cont public.containers%ROWTYPE;
BEGIN
  -- Server-side jobs (no signed-in user) and admins are not held to the list.
  IF auth.uid() IS NULL
     OR private.is_super_admin(auth.uid())
     OR private.is_yard_admin(auth.uid(), NEW.yard_id) THEN
    RETURN NEW;
  END IF;

  SELECT * INTO _cont FROM public.containers WHERE id = NEW.container_id;
  SELECT p.shipping_line, p.port_arrival_date, p.free_days, p.container_type INTO _pd
    FROM public.container_port_data p
   WHERE p.container_number = _cont.container_number AND p.yard_id = NEW.yard_id;
  IF NOT FOUND THEN
    RETURN NEW; -- not on a port list: the operator enters the arrival date
  END IF;
  -- A list entry whose trip has already come and gone (gated in on or after
  -- that arrival, and out again) is stale: this is a new trip.
  IF EXISTS (
    SELECT 1 FROM public.container_visits v
     WHERE v.container_id = NEW.container_id
       AND v.gate_out_time IS NOT NULL
       AND (v.gate_in_time AT TIME ZONE 'Asia/Amman')::date >= _pd.port_arrival_date
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.port_arrival_date IS DISTINCT FROM _pd.port_arrival_date
     OR NEW.free_days IS DISTINCT FROM _pd.free_days
     OR _cont.shipping_line IS DISTINCT FROM _pd.shipping_line
     OR (_pd.container_type IS NOT NULL AND left(_cont.container_type, 2) IS DISTINCT FROM left(_pd.container_type, 2))
  THEN
    RAISE EXCEPTION '% is on the % port list (arrival %, % free days%). Only an admin can gate it in with different values.',
      _cont.container_number, _pd.shipping_line, to_char(_pd.port_arrival_date, 'DD/MM/YYYY'), _pd.free_days,
      CASE WHEN _pd.container_type IS NULL THEN '' ELSE ', ' || left(_pd.container_type, 2) || 'ft' END
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.guard_closed_month()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _ts timestamptz;
BEGIN
  -- Separate statements: each is only planned for the table that has the column.
  IF TG_TABLE_NAME = 'shipping_line_transfers' THEN
    _ts := NEW.transferred_at;
  ELSE
    _ts := NEW.created_at;
  END IF;
  IF TG_OP = 'INSERT' AND private.is_month_closed(NEW.yard_id, _ts) THEN
    RAISE EXCEPTION '% is closed — nothing new can be dated in it', to_char(public.amman_month(_ts), 'FMMonth YYYY');
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.voided_at IS NOT NULL AND OLD.voided_at IS NULL
     AND private.is_month_closed(NEW.yard_id, _ts) THEN
    RAISE EXCEPTION '% is closed — a super admin must reopen it before anything in it is voided', to_char(public.amman_month(_ts), 'FMMonth YYYY');
  END IF;
  RETURN NEW;
END;
$function$
;

CREATE OR REPLACE FUNCTION public.inspector_checks_guard_fields()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  is_admin boolean;
BEGIN
  IF (NEW.status           IS DISTINCT FROM OLD.status)
  OR (NEW.grade            IS DISTINCT FROM OLD.grade)
  OR (NEW.container_number IS DISTINCT FROM OLD.container_number)
  OR (NEW.container_type   IS DISTINCT FROM OLD.container_type)
  OR (NEW.yard_id          IS DISTINCT FROM OLD.yard_id)
  OR (NEW.inspector_id     IS DISTINCT FROM OLD.inspector_id)
  THEN
    is_admin := private.is_super_admin(auth.uid())
             OR private.is_yard_admin(auth.uid(), OLD.yard_id);
    IF NOT is_admin THEN
      RAISE EXCEPTION
        'Only a yard admin can change an inspection''s status, grade, container number or type.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    NEW.cancelled_by := auth.uid();
    NEW.cancelled_at := now();
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$function$
;

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
      private.is_super_admin(auth.uid())
      OR (OLD.yard_id IS NOT NULL AND private.is_yard_admin(auth.uid(), OLD.yard_id))
      OR (NEW.yard_id IS NOT NULL AND private.is_yard_admin(auth.uid(), NEW.yard_id))
    ) THEN
      RAISE EXCEPTION 'Cannot change yard_id';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$
;

-- Nothing may still reach a helper through its old schema: such a call would
-- fail at run time, long after this migration reported success.
DO $$
DECLARE
  _stale text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ') INTO _stale
    FROM pg_proc p
   WHERE p.pronamespace IN ('public'::regnamespace, 'private'::regnamespace)
     AND p.prosrc ~ ('public\.(has_role|is_super_admin|is_yard_admin|current_yard_id|line_scope_ok|is_line_rep'
                     '|rep_shipping_line|is_month_closed|transfer_receipt_in_use|has_approved_inspection_for_trip)\s*\(');
  IF _stale IS NOT NULL THEN
    RAISE EXCEPTION 'Still calling a moved helper through public: %', _stale;
  END IF;
END $$;

-- ── Who may call what ───────────────────────────────────────────────────────

-- Helpers: reachable only from RLS policies and the functions above.
REVOKE ALL ON FUNCTION private.has_role(uuid, public.app_role)        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_super_admin(uuid)                   FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_yard_admin(uuid, uuid)              FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.current_yard_id()                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.line_scope_ok(text)                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_line_rep(uuid)                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.rep_shipping_line(uuid)                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.is_month_closed(uuid, timestamptz)     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.transfer_receipt_in_use(text)          FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.has_approved_inspection_for_trip(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.has_role(uuid, public.app_role)        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_super_admin(uuid)                   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_yard_admin(uuid, uuid)              TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.current_yard_id()                      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.line_scope_ok(text)                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_line_rep(uuid)                      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.rep_shipping_line(uuid)                TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_month_closed(uuid, timestamptz)     TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.transfer_receipt_in_use(text)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.has_approved_inspection_for_trip(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION private.container_in_other_yards(uuid, text, uuid) FROM PUBLIC, anon, authenticated;

-- RPCs the app calls: signed-in users only.
REVOKE ALL ON FUNCTION public.admin_edit_booking(uuid, jsonb, text)                                    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.admin_edit_container(uuid, jsonb, text)                                  FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.close_accounting_month(uuid, date, text)                                 FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.edit_shipping_line_transfer(uuid, text, text, text)                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.increment_gated_out_containers(text)                                     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_cash_count(date, public.work_shift, numeric, text)                FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.record_shipping_line_transfer(uuid, text, uuid[], text, text, text)      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.recount_cash(uuid, numeric, text)                                        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.reopen_accounting_month(uuid, text)                                      FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.void_demurrage_payment(uuid, text)                                       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.void_shipping_line_transfer(uuid, text)                                  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_edit_booking(uuid, jsonb, text)                                 TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_edit_container(uuid, jsonb, text)                               TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_accounting_month(uuid, date, text)                              TO authenticated;
GRANT EXECUTE ON FUNCTION public.edit_shipping_line_transfer(uuid, text, text, text)                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.increment_gated_out_containers(text)                                  TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_cash_count(date, public.work_shift, numeric, text)             TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_shipping_line_transfer(uuid, text, uuid[], text, text, text)   TO authenticated;
GRANT EXECUTE ON FUNCTION public.recount_cash(uuid, numeric, text)                                     TO authenticated;
GRANT EXECUTE ON FUNCTION public.reopen_accounting_month(uuid, text)                                   TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_demurrage_payment(uuid, text)                                    TO authenticated;
GRANT EXECUTE ON FUNCTION public.void_shipping_line_transfer(uuid, text)                               TO authenticated;

-- No longer called by the app.
REVOKE ALL ON FUNCTION public.rename_container(uuid, text, text) FROM PUBLIC, anon, authenticated;

NOTIFY pgrst, 'reload schema';
