-- Gate In finds a box by number even when its records are all in another yard.
--
-- Since 20261109130000 a container row is visible only to staff of a yard it
-- has a visit, an inspection or a port-list entry in (or to anyone, while it
-- has no visit at all). Gate In looked the box up with a plain select, then
-- updated its type and line or inserted it. With two yards, a box whose
-- records are all in the other yard came back as "not found", Gate In
-- inserted it again, and the unique container_number stopped it with a
-- duplicate-number error. That happened when an admin gated such a box in
-- with no inspection or port-list entry here, or when the inspection that
-- approved it was filed in the other yard.
--
-- container_for_gate_in(yard, number, type, line) does that lookup as its
-- owner and returns the container's id, creating the row for a box no yard
-- has seen. It returns only the id of a number the caller typed, so no one
-- can read anything new through it. It refuses, before anything is written:
--   * callers who could not gate in at _yard_id: not a super admin, and not
--     an admin, gate operator (user) or inspector of that yard, or a line rep;
--   * a box that is still gated in at another yard ("gate it out there
--     first"); before, that failed later on the open-visit index with the
--     generic error;
--   * a box the caller could not then gate in: one with no record in this
--     yard and no approved inspection since its last gate-out, unless the
--     caller is an admin of the yard or a super admin. That is the rule
--     container_visits_insert applies to the visit, so this can't be used to
--     change a box's type or line without the gate-in it is for.
-- A box already gated in at this yard is returned unchanged; Gate In then
-- reports it as already in the yard. Otherwise the type and line are updated
-- when they differ, as Gate In did itself.
--
-- With _check_only it runs the same checks and writes nothing, returning the
-- id or NULL for a new box. Gate In calls it that way before collecting
-- demurrage, so a refusal comes before the payment is recorded.
--
-- Errors an operator should read are check_violation (Gate In shows those
-- messages as they are); a caller who isn't gate staff gets
-- insufficient_privilege.
--
-- Uses the private helpers from 20261011120000 (has_approved_inspection_for_trip)
-- and 20261109130000 (caller_has_role, caller_yard_with_role,
-- container_in_yard). Apply this before merging the app change that calls it
-- (DEPLOY.md). Check: supabase/checks/gate_in_across_yards.sql.

CREATE OR REPLACE FUNCTION public.container_for_gate_in(
  _yard_id uuid,
  _container_number text,
  _container_type text,
  _shipping_line text,
  _check_only boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  _number    text := upper(btrim(coalesce(_container_number, '')));
  _type      text := nullif(btrim(coalesce(_container_type, '')), '');
  _line      text := nullif(btrim(coalesce(_shipping_line, '')), '');
  _super     boolean := private.caller_has_role('super_admin');
  _id        uuid;
  _cur_type  text;
  _cur_line  text;
  _open_yard uuid;
BEGIN
  IF NOT _super AND (
       _yard_id IS NULL
       OR private.caller_has_role('line_rep')
       OR private.caller_yard_with_role('{admin,user,inspector}'::public.app_role[]) IS DISTINCT FROM _yard_id) THEN
    RAISE EXCEPTION 'Only gate staff of this yard can gate a container in.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF _yard_id IS NULL THEN
    RAISE EXCEPTION 'Choose a yard before gating a container in.' USING ERRCODE = 'check_violation';
  END IF;
  IF _number !~ '^[A-Z]{4}[0-9]{7}$' THEN
    RAISE EXCEPTION 'Invalid container number "%". Expected 4 letters followed by 7 digits, e.g. MSKU1234567.', _number
      USING ERRCODE = 'check_violation';
  END IF;
  IF _type IS NULL OR _line IS NULL THEN
    RAISE EXCEPTION 'The container type and shipping line are required.' USING ERRCODE = 'check_violation';
  END IF;

  IF _check_only THEN
    SELECT id, container_type, shipping_line INTO _id, _cur_type, _cur_line
      FROM public.containers WHERE container_number = _number;
    IF _id IS NULL THEN
      RETURN NULL;  -- a new box
    END IF;
  ELSE
    -- A box no yard has seen yet: create it. ON CONFLICT covers two gate-ins
    -- of the same new box at once; the second carries on with the first's row.
    INSERT INTO public.containers (container_number, container_type, shipping_line)
    VALUES (_number, _type, _line)
    ON CONFLICT (container_number) DO NOTHING
    RETURNING id INTO _id;
    IF _id IS NOT NULL THEN
      RETURN _id;
    END IF;
    SELECT id, container_type, shipping_line INTO _id, _cur_type, _cur_line
      FROM public.containers WHERE container_number = _number
       FOR UPDATE;
  END IF;

  SELECT yard_id INTO _open_yard
    FROM public.container_visits
   WHERE container_id = _id AND gate_out_time IS NULL;
  IF _open_yard = _yard_id THEN
    RETURN _id;  -- already in this yard; Gate In says so
  ELSIF _open_yard IS NOT NULL THEN
    RAISE EXCEPTION '% is still gated in at another yard. It has to be gated out there first.', _number
      USING ERRCODE = 'check_violation';
  END IF;

  -- Every term is true or false, never NULL: a NULL would make the whole
  -- condition NULL and skip the refusal. (_yard_id is not NULL by now.)
  IF NOT (_super
          OR private.container_in_yard(_id, _number, _yard_id)
          OR private.caller_yard_with_role('{admin}'::public.app_role[]) IS NOT DISTINCT FROM _yard_id
          OR private.has_approved_inspection_for_trip(_id)) THEN
    RAISE EXCEPTION '% was last in another yard and has no approved inspection since. Inspect it here before gating it in.', _number
      USING ERRCODE = 'check_violation';
  END IF;

  IF NOT _check_only AND (_cur_type IS DISTINCT FROM _type OR _cur_line IS DISTINCT FROM _line) THEN
    UPDATE public.containers SET container_type = _type, shipping_line = _line WHERE id = _id;
  END IF;
  RETURN _id;
END;
$function$;

REVOKE ALL ON FUNCTION public.container_for_gate_in(uuid, text, text, text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.container_for_gate_in(uuid, text, text, text, boolean) TO authenticated;
