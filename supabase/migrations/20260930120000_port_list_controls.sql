-- Port lists (the Excel sheets lines send of which containers to accept, with
-- each one's vessel arrival date and free days) now drive demurrage. Three
-- database pieces go with the app changes:
--
-- 1. Activity actions for importing a port list and for an admin overriding a
--    listed container's values at gate-in.
--
-- 2. admin_edit_container can correct a visit's port arrival date and free
--    days, logged with a reason like every other correction. Gate operators
--    typed arrival dates by hand before the lists were imported, and some
--    don't match the line's list.
--
-- 3. A gate-in guard. When a container is on the port list for the yard, only
--    an admin may gate it in with a different arrival date, free days, line or
--    size, since each of those changes what is charged. The Gate In form
--    already locks these fields; this stops the same thing being done around it.
--    A list entry for a trip that has already gated out is stale and not enforced.

ALTER TYPE public.activity_action ADD VALUE IF NOT EXISTS 'port_data_imported';
ALTER TYPE public.activity_action ADD VALUE IF NOT EXISTS 'port_list_overridden';

-- ── admin_edit_container: + port_arrival_date, free_days ───────────────────
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
$$;
REVOKE EXECUTE ON FUNCTION public.admin_edit_container(uuid, jsonb, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.admin_edit_container(uuid, jsonb, text) TO authenticated;

-- ── gate-in guard ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.enforce_port_list_on_gate_in()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _pd   record;
  _cont public.containers%ROWTYPE;
BEGIN
  -- Server-side jobs (no signed-in user) and admins are not held to the list.
  IF auth.uid() IS NULL
     OR public.is_super_admin(auth.uid())
     OR public.is_yard_admin(auth.uid(), NEW.yard_id) THEN
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
$$;

REVOKE EXECUTE ON FUNCTION public.enforce_port_list_on_gate_in() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS container_visits_port_list_guard ON public.container_visits;
CREATE TRIGGER container_visits_port_list_guard
  BEFORE INSERT ON public.container_visits
  FOR EACH ROW EXECUTE FUNCTION public.enforce_port_list_on_gate_in();
