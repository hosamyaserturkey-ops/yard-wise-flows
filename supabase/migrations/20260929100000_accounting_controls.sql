-- Accounting controls: no silent edits to money, and a proper way to undo it.
--
-- 1. Lock down function access. Supabase grants EXECUTE on new functions to
--    everyone, so several SECURITY DEFINER functions were callable over the
--    API without signing in. Each already checks its caller, but nothing
--    anonymous should reach them at all. Trigger functions lose direct EXECUTE
--    entirely (triggers still fire: EXECUTE is checked when a trigger is
--    created, not each time it runs).
--
-- 2. Recorded transfers become immutable. Admins could UPDATE any column of a
--    transfer — the amount included — or DELETE it, with no trace. Now a wrong
--    reference or note is corrected through edit_shipping_line_transfer(), and
--    a wrong transfer is voided through void_shipping_line_transfer(), which
--    puts its payments back to pending. Both need a reason and are logged.
--
-- 3. Payments can be voided (refunded). void_demurrage_payment() marks a
--    payment voided with a reason; voided payments leave every total, and a
--    voided payment no longer settles its container's demurrage at the gate.
--    A payment already transferred to its line can't be voided until that
--    transfer is voided first — the money has left the yard.

-- ── 1. Function access ──────────────────────────────────────────────────────

REVOKE EXECUTE ON FUNCTION public.is_line_rep(uuid)                            FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rep_shipping_line(uuid)                      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.line_scope_ok(text)                          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.has_approved_inspection_for_trip(uuid)       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.rename_container(uuid, text, text)           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_edit_container(uuid, jsonb, text)      FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_edit_booking(uuid, jsonb, text)        FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_line_rep(uuid)                            TO authenticated;
GRANT  EXECUTE ON FUNCTION public.rep_shipping_line(uuid)                      TO authenticated;
GRANT  EXECUTE ON FUNCTION public.line_scope_ok(text)                          TO authenticated;
GRANT  EXECUTE ON FUNCTION public.has_approved_inspection_for_trip(uuid)       TO authenticated;
GRANT  EXECUTE ON FUNCTION public.rename_container(uuid, text, text)           TO authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_edit_container(uuid, jsonb, text)      TO authenticated;
GRANT  EXECUTE ON FUNCTION public.admin_edit_booking(uuid, jsonb, text)        TO authenticated;

REVOKE EXECUTE ON FUNCTION public.containers_guard_number_change()     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.canonicalize_profile_shipping_line() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.inspector_checks_guard_fields()      FROM PUBLIC, anon, authenticated;

ALTER FUNCTION public.clean_text(jsonb) SET search_path TO 'public';

-- ── Shared: audit actions and void columns ──────────────────────────────────

ALTER TYPE public.activity_action ADD VALUE IF NOT EXISTS 'payment_voided';
ALTER TYPE public.activity_action ADD VALUE IF NOT EXISTS 'transfer_voided';
ALTER TYPE public.activity_action ADD VALUE IF NOT EXISTS 'transfer_edited';

ALTER TABLE public.demurrage_payments
  ADD COLUMN IF NOT EXISTS voided_at   timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by   uuid,
  ADD COLUMN IF NOT EXISTS void_reason text;

ALTER TABLE public.shipping_line_transfers
  ADD COLUMN IF NOT EXISTS voided_at   timestamptz,
  ADD COLUMN IF NOT EXISTS voided_by   uuid,
  ADD COLUMN IF NOT EXISTS void_reason text;

-- ── 2. Transfers: no direct edits or deletes ────────────────────────────────

DROP POLICY IF EXISTS slt_update ON public.shipping_line_transfers;
DROP POLICY IF EXISTS slt_delete ON public.shipping_line_transfers;

CREATE OR REPLACE FUNCTION public.edit_shipping_line_transfer(
  _transfer_id uuid,
  _reference   text,
  _notes       text,
  _reason      text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _t public.shipping_line_transfers%ROWTYPE;
  _changes jsonb := '[]'::jsonb;
BEGIN
  SELECT * INTO _t FROM public.shipping_line_transfers WHERE id = _transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer not found';
  END IF;
  IF auth.uid() IS NULL
     OR NOT (public.is_super_admin(auth.uid()) OR public.is_yard_admin(auth.uid(), _t.yard_id)) THEN
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
$$;
REVOKE ALL ON FUNCTION public.edit_shipping_line_transfer(uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.edit_shipping_line_transfer(uuid, text, text, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.void_shipping_line_transfer(_transfer_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _t   public.shipping_line_transfers%ROWTYPE;
  _ids uuid[];
BEGIN
  SELECT * INTO _t FROM public.shipping_line_transfers WHERE id = _transfer_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Transfer not found';
  END IF;
  IF auth.uid() IS NULL
     OR NOT (public.is_super_admin(auth.uid()) OR public.is_yard_admin(auth.uid(), _t.yard_id)) THEN
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
$$;
REVOKE ALL ON FUNCTION public.void_shipping_line_transfer(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_shipping_line_transfer(uuid, text) TO authenticated;

-- ── 3. Payments: void / refund ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.void_demurrage_payment(_payment_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _p public.demurrage_payments%ROWTYPE;
BEGIN
  SELECT * INTO _p FROM public.demurrage_payments WHERE id = _payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;
  IF auth.uid() IS NULL
     OR NOT (public.is_super_admin(auth.uid()) OR public.is_yard_admin(auth.uid(), _p.yard_id)) THEN
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
$$;
REVOKE ALL ON FUNCTION public.void_demurrage_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.void_demurrage_payment(uuid, text) TO authenticated;

-- Settling skips voided payments: re-create with that check.
CREATE OR REPLACE FUNCTION public.record_shipping_line_transfer(
  _yard_id       uuid,
  _shipping_line text,
  _payment_ids   uuid[],
  _receipt_path  text,
  _reference     text DEFAULT NULL,
  _notes         text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _ids      uuid[];
  _found    integer;
  _amount   numeric;
  _transfer uuid;
BEGIN
  IF auth.uid() IS NULL
     OR NOT (public.is_super_admin(auth.uid()) OR public.is_yard_admin(auth.uid(), _yard_id)) THEN
    RAISE EXCEPTION 'Only a yard admin can record a transfer' USING ERRCODE = '42501';
  END IF;

  IF nullif(btrim(_receipt_path), '') IS NULL THEN
    RAISE EXCEPTION 'A transfer receipt is required';
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
    (_shipping_line, _amount, auth.uid(), btrim(_receipt_path), _yard_id,
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
$$;
