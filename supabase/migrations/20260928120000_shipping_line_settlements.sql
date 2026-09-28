-- Settle demurrage with shipping lines in one audited step.
--
-- Recording a transfer used to be two client calls: insert a
-- shipping_line_transfers row, then flip `transferred` on the line's pending
-- payments. That had three problems:
--
--   * the amount was typed by the client — with a date filter on it recorded
--     the filtered subtotal while every pending payment for the line was
--     marked transferred, so the transfer understated what was settled;
--   * a failure between the two calls left the transfer recorded with the
--     payments still pending (or the reverse), and two admins could settle
--     the same payments twice;
--   * nothing tied a transfer to the payments it covered.
--
-- record_shipping_line_transfer() now does it in one transaction: it locks the
-- named payments, checks they are this yard's, this line's and still pending,
-- computes the amount from them, records the transfer, links every payment to
-- it and writes an activity_log row. Direct INSERTs into
-- shipping_line_transfers and UPDATEs of demurrage_payments are no longer
-- needed by the app, so collected money can only change through audited paths.

ALTER TYPE public.activity_action ADD VALUE IF NOT EXISTS 'demurrage_transferred';

ALTER TABLE public.shipping_line_transfers
  ADD COLUMN IF NOT EXISTS reference     text,
  ADD COLUMN IF NOT EXISTS notes         text,
  ADD COLUMN IF NOT EXISTS payment_count integer;

ALTER TABLE public.demurrage_payments
  ADD COLUMN IF NOT EXISTS transfer_id uuid REFERENCES public.shipping_line_transfers(id);

CREATE INDEX IF NOT EXISTS demurrage_payments_transfer_id_idx
  ON public.demurrage_payments (transfer_id);
CREATE INDEX IF NOT EXISTS demurrage_payments_pending_idx
  ON public.demurrage_payments (yard_id, shipping_line)
  WHERE NOT transferred;

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
     AND NOT transferred;

  IF _found <> cardinality(_ids) THEN
    RAISE EXCEPTION 'Some payments are already transferred, or belong to another line or yard — refresh and try again';
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
REVOKE ALL ON FUNCTION public.record_shipping_line_transfer(uuid, text, uuid[], text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_shipping_line_transfer(uuid, text, uuid[], text, text, text) TO authenticated;

-- Transfers are created only by the function above, and collected payments
-- change only through it and the audited admin-edit functions (both SECURITY
-- DEFINER, so unaffected by RLS).
DROP POLICY IF EXISTS slt_insert ON public.shipping_line_transfers;
DROP POLICY IF EXISTS dp_update  ON public.demurrage_payments;
