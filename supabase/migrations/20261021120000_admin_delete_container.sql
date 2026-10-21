-- Deleting a container gated in by mistake.
--
-- A gate-in recorded for a box that never came in (a duplicate, a test entry,
-- a truck turned away after the record was saved) can be edited but not
-- removed: containers_delete is super-admin only and nothing in the app calls
-- it, so the record sits in the yard, on the map and in the counts until
-- someone deletes it by hand in SQL.
--
-- admin_delete_container(visit, reason) removes one visit, and the container
-- itself when that was its only visit. It is for mistakes, so it refuses
-- whatever would rewrite money or history:
--   * a visit that has gated out (its ticket, fees and booking count stand;
--     correct it with admin_edit_container instead);
--   * a trip with a demurrage payment still on file (void it first, so the
--     cash count and the line's statement move through the void as usual).
-- The inspection, port data and earlier log rows are kept. The approval goes
-- back to Awaiting Gate-In, where it can be cancelled if the box isn't coming.
-- The log row carries a full copy of the deleted rows, so the record can be
-- put back by hand if it was deleted in error.

ALTER TYPE public.activity_action ADD VALUE IF NOT EXISTS 'container_deleted';

CREATE OR REPLACE FUNCTION public.admin_delete_container(_visit_id uuid, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _visit   public.container_visits%ROWTYPE;
  _cont    public.containers%ROWTYPE;
  _paid    numeric;
  _removed boolean;
BEGIN
  IF length(btrim(coalesce(_reason, ''))) < 3 THEN
    RAISE EXCEPTION 'A reason is required to delete a container.' USING ERRCODE = 'check_violation';
  END IF;

  SELECT * INTO _visit FROM public.container_visits WHERE id = _visit_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Container record not found. It may already have been deleted.' USING ERRCODE = 'no_data_found';
  END IF;
  IF NOT (private.is_super_admin(auth.uid()) OR private.is_yard_admin(auth.uid(), _visit.yard_id)) THEN
    RAISE EXCEPTION 'Only a yard admin can delete a container.' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- Locked so a gate-in racing this one waits, then fails cleanly on the FK.
  SELECT * INTO _cont FROM public.containers WHERE id = _visit.container_id FOR UPDATE;

  IF _visit.gate_out_time IS NOT NULL THEN
    RAISE EXCEPTION '% has already gated out, so its record stays. Use Edit to correct it.', _cont.container_number
      USING ERRCODE = 'check_violation';
  END IF;

  -- This trip's payments: the same window has_approved_inspection_for_trip
  -- uses, everything since the container's last gate-out.
  SELECT sum(p.total_collected) INTO _paid
    FROM public.demurrage_payments p
   WHERE p.container_number = _cont.container_number
     AND p.yard_id = _visit.yard_id
     AND p.voided_at IS NULL
     AND p.created_at > COALESCE(
       (SELECT max(v.gate_out_time) FROM public.container_visits v
         WHERE v.container_id = _cont.id AND v.gate_out_time IS NOT NULL),
       '-infinity'::timestamptz);
  IF _paid IS NOT NULL THEN
    RAISE EXCEPTION 'Demurrage of % JOD was collected for this trip. Void the payment in Accounting first, then delete the container.',
      to_char(_paid, 'FM999999990.000') USING ERRCODE = 'check_violation';
  END IF;

  DELETE FROM public.container_visits WHERE id = _visit.id;
  -- Other trips, in this yard or another, keep the container row.
  _removed := NOT EXISTS (SELECT 1 FROM public.container_visits WHERE container_id = _cont.id);
  IF _removed THEN
    DELETE FROM public.containers WHERE id = _cont.id;
  END IF;

  INSERT INTO public.activity_log (user_id, yard_id, action, container_id, container_number, shift, occurred_at, metadata)
  VALUES (auth.uid(), _visit.yard_id, 'container_deleted', _visit.id, _cont.container_number,
          public.current_work_shift(), now(),
          jsonb_build_object('reason', btrim(_reason), 'visit_id', _visit.id,
                             'ticket_number', _visit.ticket_number, 'container_removed', _removed,
                             'visit', to_jsonb(_visit), 'container', to_jsonb(_cont)));

  RETURN jsonb_build_object('container_number', _cont.container_number, 'container_removed', _removed);
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_delete_container(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_delete_container(uuid, text) TO authenticated;
