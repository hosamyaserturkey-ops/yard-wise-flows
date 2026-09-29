-- Month close, cash drawer counts, and statements for shipping-line reps.
--
-- 6. Month close. An admin closes a finished month; the month's figures are
--    snapshotted and from then on nothing dated in it can change: no payment
--    or transfer can be added with a date inside it, and none inside it can be
--    voided. A super admin can reopen a month, with a reason. Months are
--    calendar months in Asia/Amman, like the shifts.
--
-- 7. Cash counts. At the end of a shift the cashier counts the drawer and
--    records the amount without seeing what the system expects (a blind
--    count). The expected cash — cash payments in that shift, voids excluded —
--    is computed server-side and stored beside the count, so admins see any
--    shortage or overage. One count per yard per shift.
--
-- 8. Line reps see their own line's transfers and receipts, so the yard's
--    statement for their line needs no email back and forth. Their view of
--    payments was already scoped to their line.

ALTER TYPE public.activity_action ADD VALUE IF NOT EXISTS 'month_closed';
ALTER TYPE public.activity_action ADD VALUE IF NOT EXISTS 'month_reopened';
ALTER TYPE public.activity_action ADD VALUE IF NOT EXISTS 'cash_counted';

-- ── 6. Month close ──────────────────────────────────────────────────────────

-- The calendar month (first day) an instant falls in, in Amman.
CREATE OR REPLACE FUNCTION public.amman_month(_ts timestamptz)
RETURNS date
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT date_trunc('month', _ts AT TIME ZONE 'Asia/Amman')::date;
$$;

CREATE TABLE IF NOT EXISTS public.accounting_month_closes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  yard_id       uuid NOT NULL REFERENCES public.yards(id) ON DELETE CASCADE,
  month         date NOT NULL CHECK (extract(day FROM month) = 1),
  closed_at     timestamptz NOT NULL DEFAULT now(),
  closed_by     uuid NOT NULL,
  notes         text,
  summary       jsonb NOT NULL,
  reopened_at   timestamptz,
  reopened_by   uuid,
  reopen_reason text
);
CREATE UNIQUE INDEX IF NOT EXISTS accounting_month_closes_open_uniq
  ON public.accounting_month_closes (yard_id, month) WHERE reopened_at IS NULL;

ALTER TABLE public.accounting_month_closes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.accounting_month_closes FROM anon, authenticated;
GRANT SELECT ON public.accounting_month_closes TO authenticated;
DROP POLICY IF EXISTS amc_select ON public.accounting_month_closes;
CREATE POLICY amc_select ON public.accounting_month_closes FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.is_yard_admin(auth.uid(), yard_id));
-- No write policies: closing and reopening go through the functions below.

CREATE OR REPLACE FUNCTION public.is_month_closed(_yard uuid, _ts timestamptz)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.accounting_month_closes
     WHERE yard_id = _yard AND month = public.amman_month(_ts) AND reopened_at IS NULL
  );
$$;
REVOKE ALL ON FUNCTION public.is_month_closed(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_month_closed(uuid, timestamptz) TO authenticated;

-- Guards on the money tables: nothing new may be dated inside a closed month,
-- and nothing inside one may be voided — whichever path tries it.
CREATE OR REPLACE FUNCTION public.guard_closed_month()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _ts timestamptz;
BEGIN
  -- Separate statements: each is only planned for the table that has the column.
  IF TG_TABLE_NAME = 'shipping_line_transfers' THEN
    _ts := NEW.transferred_at;
  ELSE
    _ts := NEW.created_at;
  END IF;
  IF TG_OP = 'INSERT' AND public.is_month_closed(NEW.yard_id, _ts) THEN
    RAISE EXCEPTION '% is closed — nothing new can be dated in it', to_char(public.amman_month(_ts), 'FMMonth YYYY');
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.voided_at IS NOT NULL AND OLD.voided_at IS NULL
     AND public.is_month_closed(NEW.yard_id, _ts) THEN
    RAISE EXCEPTION '% is closed — a super admin must reopen it before anything in it is voided', to_char(public.amman_month(_ts), 'FMMonth YYYY');
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.guard_closed_month() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS demurrage_payments_closed_month ON public.demurrage_payments;
CREATE TRIGGER demurrage_payments_closed_month
  BEFORE INSERT OR UPDATE ON public.demurrage_payments
  FOR EACH ROW EXECUTE FUNCTION public.guard_closed_month();

DROP TRIGGER IF EXISTS shipping_line_transfers_closed_month ON public.shipping_line_transfers;
CREATE TRIGGER shipping_line_transfers_closed_month
  BEFORE INSERT OR UPDATE ON public.shipping_line_transfers
  FOR EACH ROW EXECUTE FUNCTION public.guard_closed_month();

CREATE OR REPLACE FUNCTION public.close_accounting_month(_yard_id uuid, _month date, _notes text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _m       date := date_trunc('month', _month)::date;
  _start   timestamptz;
  _end     timestamptz;
  _summary jsonb;
  _id      uuid;
BEGIN
  IF auth.uid() IS NULL
     OR NOT (public.is_super_admin(auth.uid()) OR public.is_yard_admin(auth.uid(), _yard_id)) THEN
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
$$;
REVOKE ALL ON FUNCTION public.close_accounting_month(uuid, date, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_accounting_month(uuid, date, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.reopen_accounting_month(_close_id uuid, _reason text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _c public.accounting_month_closes%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL OR NOT public.is_super_admin(auth.uid()) THEN
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
$$;
REVOKE ALL ON FUNCTION public.reopen_accounting_month(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reopen_accounting_month(uuid, text) TO authenticated;

-- ── 7. Cash counts ──────────────────────────────────────────────────────────

-- Same boundaries as shiftForDate() in src/lib/shifts.ts: day is 06:00–17:59
-- local; the night shift dated D runs from 18:00 on D to 06:00 on D+1.
CREATE OR REPLACE FUNCTION public.shift_window(_date date, _shift public.work_shift)
RETURNS tstzrange
LANGUAGE sql STABLE
SET search_path TO 'public'
AS $$
  SELECT CASE _shift
    WHEN 'day' THEN tstzrange((_date + time '06:00') AT TIME ZONE 'Asia/Amman',
                              (_date + time '18:00') AT TIME ZONE 'Asia/Amman', '[)')
    ELSE            tstzrange((_date + time '18:00') AT TIME ZONE 'Asia/Amman',
                              (_date + 1 + time '06:00') AT TIME ZONE 'Asia/Amman', '[)')
  END;
$$;

CREATE TABLE IF NOT EXISTS public.cash_counts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  yard_id       uuid NOT NULL REFERENCES public.yards(id) ON DELETE CASCADE,
  shift_date    date NOT NULL,
  shift         public.work_shift NOT NULL,
  counted_cash  numeric(12,3) NOT NULL CHECK (counted_cash >= 0),
  expected_cash numeric(12,3) NOT NULL,
  difference    numeric(12,3) GENERATED ALWAYS AS (counted_cash - expected_cash) STORED,
  payment_count integer NOT NULL,
  counted_by    uuid NOT NULL,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (yard_id, shift_date, shift)
);

ALTER TABLE public.cash_counts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.cash_counts FROM anon, authenticated;
GRANT SELECT ON public.cash_counts TO authenticated;
DROP POLICY IF EXISTS cc_select ON public.cash_counts;
CREATE POLICY cc_select ON public.cash_counts FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid())
         OR public.is_yard_admin(auth.uid(), yard_id)
         OR counted_by = auth.uid());
-- No write policies: counts are recorded only through record_cash_count().

CREATE OR REPLACE FUNCTION public.record_cash_count(
  _shift_date date,
  _shift      public.work_shift,
  _counted    numeric,
  _notes      text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _yard     uuid := public.current_yard_id();
  _window   tstzrange := public.shift_window(_shift_date, _shift);
  _expected numeric;
  _count    integer;
  _id       uuid;
BEGIN
  IF auth.uid() IS NULL OR _yard IS NULL THEN
    RAISE EXCEPTION 'Your account has no yard' USING ERRCODE = '42501';
  END IF;
  IF public.is_line_rep(auth.uid()) OR public.has_role(auth.uid(), 'inspector') THEN
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
$$;
REVOKE ALL ON FUNCTION public.record_cash_count(date, public.work_shift, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_cash_count(date, public.work_shift, numeric, text) TO authenticated;

-- ── 8. Line reps: their line's transfers and receipts ───────────────────────

ALTER POLICY slt_select ON public.shipping_line_transfers
  USING (
    public.is_super_admin(auth.uid())
    OR public.is_yard_admin(auth.uid(), yard_id)
    OR (yard_id = public.current_yard_id()
        AND public.is_line_rep(auth.uid())
        AND public.line_scope_ok(shipping_line))
  );

-- A rep may open a receipt only when it belongs to a transfer they can see
-- (the subquery runs under the policy above, so it is their line's).
DROP POLICY IF EXISTS "Line reps can view their line's transfer receipts" ON storage.objects;
CREATE POLICY "Line reps can view their line's transfer receipts" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'transfer-receipts'
    AND public.is_line_rep(auth.uid())
    AND EXISTS (SELECT 1 FROM public.shipping_line_transfers t WHERE t.receipt_url = storage.objects.name)
  );
