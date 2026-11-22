-- Add the OVP and HKY shipping lines.
--
-- The booking form and the edit dialogs (container, booking) build their line
-- dropdowns from this table, and the admin edit functions reject any line code
-- not listed here. Gate In, Reports, Port Data and User Management read the
-- static SHIPPING_LINES list in src/lib/shippingLines.ts, which gets the same
-- two codes in the same change.
--
-- name is set to the code, as for the other lines: no separate display name is
-- on file. Neither line has demurrage tier rules yet (src/lib/demurrage.ts), so
-- they are treated like the other uncharged lines until rules are added.

INSERT INTO public.shipping_lines (code, name) VALUES
  ('OVP', 'OVP'),
  ('HKY', 'HKY')
ON CONFLICT (code) DO NOTHING;
