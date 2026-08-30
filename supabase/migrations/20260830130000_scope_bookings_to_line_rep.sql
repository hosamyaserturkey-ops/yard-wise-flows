-- Scope a line rep's booking list to their own line.
--
-- When reps were first allowed to read bookings (20260727150000) the table had
-- no shipping_line column, so the grant was yard-wide by necessity —
-- "bookings have no shipping-line column, so this is yard-wide". 20260824170000
-- added bookings.shipping_line and backfilled it, but this policy was never
-- narrowed, so a rep still read every line's bookings in their yard: customer
-- names, container counts and gate-out progress belonging to competitors.
--
-- A booking with no line on file stays visible to every rep, matching
-- bookingMatchesLine() in src/lib/bookingScope.ts: a line-less booking is one
-- any container may be reserved against, so it is as much this rep's booking as
-- anyone's. line_scope_ok() is true for every non-rep role, so nothing changes
-- for admins, operators or inspectors.

ALTER POLICY bookings_select ON public.bookings
  USING (
    is_super_admin(auth.uid())
    OR (
      yard_id = current_yard_id()
      AND (shipping_line IS NULL OR public.line_scope_ok(shipping_line))
    )
  );
