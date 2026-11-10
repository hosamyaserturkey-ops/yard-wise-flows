-- =====================================================================
-- CAR LOT - PART 1 of 2  (run this ALONE, let it commit, then run part 2)
-- Project: Container Yard (qctvjwlaxnidprhcxodj)
-- STATUS: draft, NOT applied anywhere.
--
-- Postgres cannot use a newly added enum value in the same transaction
-- that adds it, so this one line has to be its own migration.
-- =====================================================================

alter type public.app_role add value if not exists 'manufacturer_rep';
-- Read-only owner/auditor: sees the car lot, writes nothing (plan decision 2).
alter type public.app_role add value if not exists 'read_only_admin';
