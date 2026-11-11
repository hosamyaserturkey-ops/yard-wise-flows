-- =====================================================================
-- CAR LOT - PART 1 of 2  (run this ALONE, let it commit, then run part 2)
-- Project: Container Yard (qctvjwlaxnidprhcxodj)
-- STATUS: APPLIED to production on 2026-11-11 (migration car_lot_part1_enum).
--
-- Postgres cannot use a newly added enum value in the same transaction
-- that adds it, so this one line has to be its own migration.
-- =====================================================================

alter type public.app_role add value if not exists 'manufacturer_rep';
-- Read-only admin: belongs to ONE yard, sees only that yard, writes nothing
-- (plan decision 2, clarified 2026-11-10).
alter type public.app_role add value if not exists 'read_only_admin';
