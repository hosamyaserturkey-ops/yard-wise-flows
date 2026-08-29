-- Seed the real shipping lines into the lookup table.
--
-- shipping_lines was created with only two rows ('SLD', 'Shipping Line D') and
-- ('SLG', 'Shipping Line G') — placeholder names from the migration that
-- introduced the table. Every screen except the booking form reads the static
-- SHIPPING_LINES list in src/lib/shippingLines.ts, which carries all eight
-- codes actually in use, so the divergence only showed up on Create New
-- Booking: that dropdown is the one fed from this table, and it offered two
-- lines while the yard holds containers for WOM, 7Seas, EEL and Gezairi.
--
-- Insert the missing codes so the booking form matches the rest of the app,
-- and give SLD/SLG their real carrier names (the same ones
-- SHIPPING_LINE_NAME_MAP in PortDemurrageData.tsx resolves spreadsheet
-- imports to).

INSERT INTO public.shipping_lines (code, name) VALUES
  ('SFT', 'Swift Flow'),
  ('7Seas', '7 Seas'),
  ('WOM', 'WOM Lines'),
  ('EEL', 'EEL Shipping'),
  ('Gezairi', 'Gezairi Transport'),
  ('SaM', 'SaM Shipping')
ON CONFLICT (code) DO NOTHING;

UPDATE public.shipping_lines SET name = 'Sea Lead'   WHERE code = 'SLD' AND name = 'Shipping Line D';
UPDATE public.shipping_lines SET name = 'Sea Legend' WHERE code = 'SLG' AND name = 'Shipping Line G';
