-- admin_delete_container, callable before and after the helper move.
--
-- 20261021120000 called private.is_super_admin / private.is_yard_admin, but
-- production has not had 20261011120000_lock_down_security_definer_functions
-- applied yet: the helpers are still in public and there is no private
-- schema, so every delete failed with 'schema "private" does not exist'.
--
-- The helpers are now called by name, with private searched first. Before the
-- lock-down they resolve in public; after it moves them they resolve in
-- private. The lock-down's stale-reference check only looks for public.*
-- calls, so it still passes. The body is otherwise unchanged.

CREATE OR REPLACE FUNCTION public.admin_delete_container(_visit_id uuid, _reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'private', 'public'
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
  IF NOT (is_super_admin(auth.uid()) OR is_yard_admin(auth.uid(), _visit.yard_id)) THEN
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
