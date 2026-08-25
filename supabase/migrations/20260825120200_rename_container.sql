-- Correcting a container number after gate-in.
--
-- A container gated in under a mistyped number is stuck: the number is the
-- yard's identity for the box, it is UNIQUE on public.containers, and it is
-- denormalised across six more tables. There is no way to fix it today.
--
-- Two things happen here:
--   1. rename_container(): an admin-only, all-or-nothing rename that cascades
--      to every table storing the number, so the inspection, photos, port data,
--      demurrage and history follow the container.
--   2. A guard trigger on public.containers. containers_update is currently
--      USING (auth.uid() IS NOT NULL AND NOT is_line_rep(...)), i.e. ANY
--      operator can already rename ANY container straight through the API.
--      The trigger closes that: the number may only change for an admin.

CREATE OR REPLACE FUNCTION public.rename_container(
  _container_id uuid,
  _new_number   text,
  _reason       text DEFAULT NULL
)
RETURNS TABLE (old_number text, new_number text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _old        text;
  _new        text;
  _yard       uuid;
  _clash      record;
  _clash_desc text;
BEGIN
  _new := upper(btrim(coalesce(_new_number, '')));

  -- Same layout the containers/container_port_data CHECK constraints enforce
  -- (ISO 6346: 4 letters, 7 digits) and the app validates client-side.
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

  -- Only while the container is still in the yard. Renaming a closed trip
  -- would rewrite printed tickets and settled demurrage after the fact.
  SELECT yard_id INTO _yard
    FROM public.container_visits
   WHERE container_id = _container_id AND gate_out_time IS NULL
   LIMIT 1;
  IF _yard IS NULL THEN
    RAISE EXCEPTION 'Only a container currently in the yard can be renamed. % has no open visit.', _old
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT (public.is_super_admin(auth.uid()) OR public.is_yard_admin(auth.uid(), _yard)) THEN
    RAISE EXCEPTION 'Only a yard admin can correct a container number.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Collision: merging two container histories is a different and far riskier
  -- operation, so this refuses and says what the other record is instead.
  SELECT c.id,
         (v.id IS NOT NULL)              AS in_yard,
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

  -- container_port_data is UNIQUE (container_number, yard_id), so a cascade
  -- can collide there even when the containers row is free. Refuse rather
  -- than silently picking one of the two port records.
  IF EXISTS (SELECT 1 FROM public.container_port_data WHERE container_number = _old)
     AND EXISTS (SELECT 1 FROM public.container_port_data WHERE container_number = _new)
  THEN
    RAISE EXCEPTION
      'Port data exists under both % and %. Delete the wrong port record first, then rename.', _old, _new
      USING ERRCODE = 'unique_violation';
  END IF;

  -- Cascade. No FKs reference container_number, so each table is updated by
  -- value. All of it is one transaction: either every table moves or none does.
  UPDATE public.inspector_checks     SET container_number = _new WHERE container_number = _old;
  UPDATE public.container_port_data  SET container_number = _new WHERE container_number = _old;
  UPDATE public.demurrage_payments   SET container_number = _new WHERE container_number = _old;
  UPDATE public.container_demurrage  SET container_number = _new WHERE container_number = _old;
  UPDATE public.edi_transmissions    SET container_number = _new WHERE container_number = _old;
  UPDATE public.activity_log         SET container_number = _new WHERE container_number = _old;
  UPDATE public.containers           SET container_number = _new WHERE id = _container_id;

  -- Written after the cascade and directly (not via the client helper) so the
  -- audit row lands inside this transaction and is not itself rewritten by the
  -- activity_log update above.
  INSERT INTO public.activity_log (user_id, yard_id, action, container_id, container_number, shift, occurred_at, metadata)
  VALUES (
    auth.uid(), _yard, 'container_renamed', _container_id, _new,
    -- Same boundaries as shiftForDate() in src/lib/shifts.ts: day is 06:00-17:59
    -- local. The yard runs on Asia/Amman, which is what the browser reports there.
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
$$;

GRANT EXECUTE ON FUNCTION public.rename_container(uuid, text, text) TO authenticated;

-- Guard: the container number may only change for an admin, whatever route the
-- update takes. rename_container is SECURITY DEFINER but auth.uid() still
-- resolves to the calling admin, so it passes this check normally.
CREATE OR REPLACE FUNCTION public.containers_guard_number_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.container_number IS DISTINCT FROM OLD.container_number THEN
    IF NOT (public.is_super_admin(auth.uid())
            OR EXISTS (SELECT 1 FROM public.user_roles
                        WHERE user_id = auth.uid() AND role = 'admin'))
    THEN
      RAISE EXCEPTION 'Only a yard admin can change a container number.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS containers_guard_number_change ON public.containers;
CREATE TRIGGER containers_guard_number_change
  BEFORE UPDATE ON public.containers
  FOR EACH ROW EXECUTE FUNCTION public.containers_guard_number_change();
