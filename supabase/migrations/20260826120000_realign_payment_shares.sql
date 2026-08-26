-- Realign the stored payment shares with how the money actually splits.
--
-- Demurrage is collected on the shipping line's behalf and is owed to that
-- line in full; the service fee is what the yard earns. The columns were
-- previously filled with a split of the service fee alone (yard 5 / line 2),
-- which understated what each shipping line is owed.
--
-- The Accounting page now derives both figures from demurrage_amount and
-- service_fee, so this backfill only brings the stored columns in line.

UPDATE public.demurrage_payments
SET yard_share = service_fee,
    shipping_line_share = demurrage_amount
WHERE yard_share IS DISTINCT FROM service_fee
   OR shipping_line_share IS DISTINCT FROM demurrage_amount;
