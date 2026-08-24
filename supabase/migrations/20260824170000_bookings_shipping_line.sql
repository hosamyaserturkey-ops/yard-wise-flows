-- Tie a booking to a shipping line.
--
-- Bookings had no line column, so every booking was offered for every
-- container: an EEL container could be reserved or gated out against a WOM
-- booking, and the counter on that WOM booking would be bumped for a box the
-- line never shipped. Bookings belong to one line in practice — the number is
-- issued by that line — so the column records it and the app filters on it.
--
-- Nullable rather than NOT NULL: existing rows are backfilled below where the
-- line can be inferred, but a booking with no containers linked yet has
-- nothing to infer from. New bookings always carry a line (the create form
-- requires one); the app shows an unassigned booking for any line, flagged.
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS shipping_line text;

COMMENT ON COLUMN public.bookings.shipping_line IS
  'Shipping line the booking belongs to. Containers of other lines cannot be reserved or gated out against it. Null = legacy booking with no line on file.';

-- Backfill from the containers already linked to each booking. Where a booking
-- somehow spans lines, the most-used line wins (ties broken alphabetically so
-- the result is deterministic).
UPDATE public.bookings b
SET shipping_line = inferred.line
FROM (
  SELECT DISTINCT ON (v.booking_id)
         v.booking_id,
         c.shipping_line AS line
  FROM public.container_visits v
  JOIN public.containers c ON c.id = v.container_id
  WHERE v.booking_id IS NOT NULL
  GROUP BY v.booking_id, c.shipping_line
  ORDER BY v.booking_id, count(*) DESC, c.shipping_line
) AS inferred
WHERE b.id = inferred.booking_id
  AND b.shipping_line IS NULL;
