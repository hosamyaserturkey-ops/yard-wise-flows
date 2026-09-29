-- Admin cash recounts, and transfer receipts that can't be seen across yards
-- or tampered with.
--
-- Recount. A cashier gets one count per shift. When it was wrong, a yard
-- admin records a recount with a reason: the counted amount is replaced, the
-- first count is kept in original_counted_cash, and the expected cash is
-- recomputed so a payment voided since is reflected. Every recount is logged.
--
-- Receipts. The storage rules for the transfer-receipts bucket checked only
-- "is an admin of some yard", so:
--   * an admin of any yard could open every yard's receipts;
--   * an admin of any yard could overwrite or delete any receipt, including
--     the proof behind a recorded transfer;
--   * uploads could go anywhere in the bucket, and a transfer could point at
--     any path, even one never uploaded.
-- Now: new receipts live under their yard's folder (<yard_id>/...); admins see
-- a receipt only through a transfer they can see (their yard) or their own
-- upload; nobody can overwrite a receipt; only the uploader can delete one, and
-- only while no transfer uses it (the page cleans up after a failed save).
-- record_shipping_line_transfer() requires the receipt to be an uploaded file
-- in the yard's folder that no other transfer already uses.

ALTER TYPE public.activity_action ADD VALUE IF NOT EXISTS 'cash_recounted';

-- ── Recount ─────────────────────────────────────────────────────────────────

ALTER TABLE public.cash_counts
  ADD COLUMN IF NOT EXISTS original_counted_cash numeric(12,3),
  ADD COLUMN IF NOT EXISTS recounted_at   timestamptz,
  ADD COLUMN IF NOT EXISTS recounted_by   uuid,
  ADD COLUMN IF NOT EXISTS recount_reason text;

CREATE OR REPLACE FUNCTION public.recount_cash(_cash_count_id uuid, _counted numeric, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
     OR NOT (public.is_super_admin(auth.uid()) OR public.is_yard_admin(auth.uid(), _c.yard_id)) THEN
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
$$;
REVOKE ALL ON FUNCTION public.recount_cash(uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recount_cash(uuid, numeric, text) TO authenticated;

-- ── Receipts ────────────────────────────────────────────────────────────────

-- Whether any transfer (in any yard) uses this receipt. Bypasses row security
-- on purpose: a receipt another yard relies on must still count as in use.
CREATE OR REPLACE FUNCTION public.transfer_receipt_in_use(_path text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (SELECT 1 FROM public.shipping_line_transfers WHERE receipt_url = _path);
$$;
REVOKE ALL ON FUNCTION public.transfer_receipt_in_use(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_receipt_in_use(text) TO authenticated;

DROP POLICY IF EXISTS "Admins can view transfer receipts"   ON storage.objects;
DROP POLICY IF EXISTS "Admins can upload transfer receipts" ON storage.objects;
DROP POLICY IF EXISTS "Admins can update transfer receipts" ON storage.objects;
DROP POLICY IF EXISTS "Admins can delete transfer receipts" ON storage.objects;
DROP POLICY IF EXISTS "Admins view their yard's transfer receipts"      ON storage.objects;
DROP POLICY IF EXISTS "Admins upload receipts into their yard's folder" ON storage.objects;
DROP POLICY IF EXISTS "Uploaders delete their own unused receipts"     ON storage.objects;

-- The subquery runs under shipping_line_transfers' own row security, so an
-- admin sees only receipts behind their yard's transfers.
CREATE POLICY "Admins view their yard's transfer receipts" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'transfer-receipts'
    AND (
      public.is_super_admin(auth.uid())
      OR (public.has_role(auth.uid(), 'admin')
          AND (owner = auth.uid()
               OR EXISTS (SELECT 1 FROM public.shipping_line_transfers t WHERE t.receipt_url = storage.objects.name)))
    )
  );

CREATE POLICY "Admins upload receipts into their yard's folder" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'transfer-receipts'
    AND (
      public.is_super_admin(auth.uid())
      OR (public.has_role(auth.uid(), 'admin')
          AND (storage.foldername(name))[1] = public.current_yard_id()::text)
    )
  );

-- No UPDATE policy: a receipt, once uploaded, can't be overwritten.

CREATE POLICY "Uploaders delete their own unused receipts" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'transfer-receipts'
    AND owner = auth.uid()
    AND NOT public.transfer_receipt_in_use(name)
  );

-- Settling now requires a real, unused receipt in the yard's own folder.
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
  _path     text := btrim(_receipt_path);
BEGIN
  IF auth.uid() IS NULL
     OR NOT (public.is_super_admin(auth.uid()) OR public.is_yard_admin(auth.uid(), _yard_id)) THEN
    RAISE EXCEPTION 'Only a yard admin can record a transfer' USING ERRCODE = '42501';
  END IF;

  IF nullif(_path, '') IS NULL THEN
    RAISE EXCEPTION 'A transfer receipt is required';
  END IF;
  IF left(_path, length(_yard_id::text) + 1) <> _yard_id::text || '/'
     OR NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id = 'transfer-receipts' AND name = _path) THEN
    RAISE EXCEPTION 'The receipt upload was not found — upload it again';
  END IF;
  IF public.transfer_receipt_in_use(_path) THEN
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
$$;
