-- Admin corrections to containers, visits and bookings — every change logged.
--
-- Admins could only correct a container number (rename_container), and only
-- while the container was in the yard. Anything else typed wrong at the gate —
-- the shipping line, the size/type, a driver's name, a truck, a time — could
-- not be fixed at all. Two admin-only functions now cover it:
--
--   admin_edit_container(visit, changes, reason) — the container itself
--     (number, line, type) and the fields of one of its visits.
--   admin_edit_booking(booking, changes, reason) — a booking's customer,
--     number, line, container count and status.
--
-- Both work on any container or booking, in the yard or long gone. A reason
-- is required, and each call writes one activity_log row naming who changed
-- what, from what, to what, and why. Everything happens in one transaction:
-- either every change and its log row land, or nothing does.

ALTER TYPE public.activity_action ADD VALUE IF NOT EXISTS 'container_edited';
ALTER TYPE public.activity_action ADD VALUE IF NOT EXISTS 'booking_edited';

-- Same boundaries as shiftForDate() in src/lib/shifts.ts: day is 06:00-17:59
-- local. The yard runs on Asia/Amman.
CREATE OR REPLACE FUNCTION public.current_work_shift()
RETURNS public.work_shift
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT CASE
    WHEN extract(hour FROM now() AT TIME ZONE 'Asia/Amman') >= 6
     AND extract(hour FROM now() AT TIME ZONE 'Asia/Amman') < 18
    THEN 'day'::public.work_shift ELSE 'night'::public.work_shift
  END;
$$;

-- Moves a container number across every table that stores it by value.
-- Internal: callers must have checked permissions and collisions first.
CREATE OR REPLACE FUNCTION public.cascade_container_number(_container_id uuid, _old text, _new text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  UPDATE public.inspector_checks     SET container_number = _new WHERE container_number = _old;
  UPDATE public.container_port_data  SET container_number = _new WHERE container_number = _old;
  UPDATE public.demurrage_payments   SET container_number = _new WHERE container_number = _old;
  UPDATE public.edi_transmissions    SET container_number = _new WHERE container_number = _old;
  UPDATE public.activity_log         SET container_number = _new WHERE container_number = _old;
  UPDATE public.containers           SET container_number = _new WHERE id = _container_id;
END;
$$;
REVOKE ALL ON FUNCTION public.cascade_container_number(uuid, text, text) FROM PUBLIC, anon, authenticated;

-- Trimmed text, with blank meaning "clear it".
CREATE OR REPLACE FUNCTION public.clean_text(_v jsonb)
RETURNS text
LANGUAGE sql IMMUTABLE
AS $$
  SELECT nullif(btrim(_v #>> '{}'), '');
$$;

CREATE OR REPLACE FUNCTION public.admin_edit_container(
  _visit_id uuid,
  _changes  jsonb,
  _reason   text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
    'gate_out_driver_name', 'gate_out_truck_number', 'gate_out_time', 'seal_number', 'fees'
  ];
  _new_number text;
  _new_line   text;
  _new_type   text;
  _txt        text;
  _ts         timestamptz;
  _num        numeric;
  _clash      record;
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
  IF NOT (public.is_super_admin(auth.uid()) OR public.is_yard_admin(auth.uid(), _visit.yard_id)) THEN
    RAISE EXCEPTION 'Only a yard admin can edit container records.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  SELECT * INTO _cont FROM public.containers WHERE id = _visit.container_id FOR UPDATE;

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

  IF jsonb_array_length(_log) = 0 THEN
    RAISE EXCEPTION 'Nothing changed — every value is already what you entered.' USING ERRCODE = 'check_violation';
  END IF;

  INSERT INTO public.activity_log (user_id, yard_id, action, container_id, container_number, shift, occurred_at, metadata)
  VALUES (auth.uid(), _visit.yard_id, 'container_edited', _visit.id, _cont.container_number,
          public.current_work_shift(), now(),
          jsonb_build_object('changes', _log, 'reason', btrim(_reason), 'visit_id', _visit.id));

  RETURN _log;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_edit_container(uuid, jsonb, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_edit_booking(
  _booking_id uuid,
  _changes    jsonb,
  _reason     text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
  IF NOT (public.is_super_admin(auth.uid()) OR public.is_yard_admin(auth.uid(), _b.yard_id)) THEN
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
      -- Visits keep a copy of the number for tickets and reports.
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
$$;
GRANT EXECUTE ON FUNCTION public.admin_edit_booking(uuid, jsonb, text) TO authenticated;
