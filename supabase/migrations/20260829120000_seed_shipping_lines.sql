-- Seed the real shipping lines into the lookup table.
--
-- shipping_lines was created holding only ('SLD', 'Shipping Line D') and
-- ('SLG', 'Shipping Line G') — placeholders from the migration that
-- introduced the table. Every screen except the booking form reads the static
-- SHIPPING_LINES list in src/lib/shippingLines.ts, so the gap only showed up
-- on Create New Booking: that dropdown is the one fed from this table, and it
-- offered two lines while the yard holds containers for WOM, 7Seas, EEL and
-- Gezairi. Since bookings.shipping_line gates which containers can be
-- reserved or gated out against a booking, those lines could not be booked at
-- all.
--
-- Codes are spelled exactly as the existing rows in containers, bookings,
-- demurrage_payments and profiles spell them ('7Seas' and 'Gezairi' in mixed
-- case, not '7SEAS'/'GEZAIRI'): the columns are plain text compared for
-- equality, so a differently-cased code here would silently fail to match the
-- containers already in the yard.
--
-- name is set to the code because these lines have no separate display name on
-- file; the booking dropdown renders just the code when the two are equal.

INSERT INTO public.shipping_lines (code, name) VALUES
  ('WOM', 'WOM'),
  ('SFT', 'SFT'),
  ('7Seas', '7Seas'),
  ('EEL', 'EEL'),
  ('Gezairi', 'Gezairi')
ON CONFLICT (code) DO NOTHING;

-- Drop the invented names off the two placeholder rows; the codes are real,
-- the "Shipping Line D"/"Shipping Line G" labels never were.
UPDATE public.shipping_lines SET name = code
WHERE (code = 'SLD' AND name = 'Shipping Line D')
   OR (code = 'SLG' AND name = 'Shipping Line G');
