-- Data-quality checks for gate records (container_visits).
--
-- Every statement here is a SELECT: run them one at a time in the Supabase SQL
-- editor. Nothing changes data. The suggested fixes at the end are commented
-- out on purpose; see report-2026-10-11.md before using any of them.
--
-- Times are shown in Asia/Amman, the zone the yard works in.

-- ── 1. Visits with no driver recorded ──────────────────────────────────────
-- Expect: the 9 back-filled July visits (tickets 1-9, booking "To ACT").
SELECT v.ticket_number,
       c.container_number,
       to_char(v.gate_in_time  AT TIME ZONE 'Asia/Amman', 'YYYY-MM-DD HH24:MI') AS gate_in,
       to_char(v.gate_out_time AT TIME ZONE 'Asia/Amman', 'YYYY-MM-DD HH24:MI') AS gate_out,
       v.booking_number,
       nullif(btrim(v.driver_name), '') IS NULL                                  AS no_gate_in_driver,
       v.gate_out_time IS NOT NULL AND nullif(btrim(v.gate_out_driver_name), '') IS NULL AS no_gate_out_driver
  FROM public.container_visits v
  JOIN public.containers c ON c.id = v.container_id
 WHERE nullif(btrim(v.driver_name), '') IS NULL
    OR (v.gate_out_time IS NOT NULL AND nullif(btrim(v.gate_out_driver_name), '') IS NULL)
 ORDER BY v.ticket_number;

-- ── 2. Placeholder values ("N/A", "unknown", "000000", the word "NULL", ...) ─
WITH fields AS (
  SELECT id, ticket_number, 'driver_name'           AS field, driver_name           AS value FROM public.container_visits
  UNION ALL SELECT id, ticket_number, 'gate_out_driver_name',  gate_out_driver_name  FROM public.container_visits
  UNION ALL SELECT id, ticket_number, 'truck_number',          truck_number          FROM public.container_visits
  UNION ALL SELECT id, ticket_number, 'gate_out_truck_number', gate_out_truck_number FROM public.container_visits
  UNION ALL SELECT id, ticket_number, 'seal_number',           seal_number           FROM public.container_visits
)
SELECT field, value, count(*) AS visits, array_agg(ticket_number ORDER BY ticket_number) AS tickets
  FROM fields
 WHERE value IS NOT NULL
   AND (upper(btrim(value)) IN ('N/A', 'NA', 'N.A', 'N.A.', 'NONE', 'NULL', 'NIL', 'UNKNOWN', 'UNKOWN', 'UNKNOW',
                                'TBD', 'TEST', 'X', 'XX', 'XXX', '-', '--', '.', '?')
        OR btrim(value) ~ '^0+$')
 GROUP BY field, value
 ORDER BY field, visits DESC;

-- ── 3. Truck numbers that aren't a 7-digit local plate ─────────────────────
-- Foreign and older plates are legitimate; a letters-only value is usually a
-- placeholder or a name typed into the wrong field.
SELECT v.ticket_number,
       side,
       plate,
       length(regexp_replace(plate, '[^0-9]', '', 'g')) AS digits,
       CASE WHEN plate !~ '[0-9]' THEN 'no digits'
            WHEN plate ~ '[A-Za-z]' THEN 'letters and digits'
            ELSE 'too few digits' END                   AS why
  FROM public.container_visits v
 CROSS JOIN LATERAL (VALUES ('gate-in', v.truck_number), ('gate-out', v.gate_out_truck_number)) AS t(side, plate)
 WHERE plate IS NOT NULL
   AND regexp_replace(upper(plate), '[\s-]', '', 'g') !~ '^[0-9]{7}$'
 ORDER BY v.ticket_number, side;

-- ── 4. Driver names that differ only by case or spacing ────────────────────
WITH names AS (
  SELECT driver_name AS name FROM public.container_visits WHERE nullif(btrim(driver_name), '') IS NOT NULL
  UNION ALL
  SELECT gate_out_driver_name FROM public.container_visits WHERE nullif(btrim(gate_out_driver_name), '') IS NOT NULL
)
SELECT upper(regexp_replace(btrim(name), '\s+', ' ', 'g')) AS one_spelling,
       count(*)                                           AS uses,
       array_agg(DISTINCT name)                           AS as_typed
  FROM names
 GROUP BY 1
HAVING count(DISTINCT name) > 1
 ORDER BY uses DESC;

-- ── 5. Possible spelling variants (needs a person to decide) ───────────────
-- Groups names whose consonants match once case, spacing, vowels and doubled
-- letters are ignored (MOHAMMAD / MOHAMMED / MUHAMAD). Most records hold a
-- first name only, so a group can be several different drivers: review, don't
-- merge automatically. Latin script only.
WITH names AS (
  SELECT driver_name AS name FROM public.container_visits WHERE nullif(btrim(driver_name), '') IS NOT NULL
  UNION ALL
  SELECT gate_out_driver_name FROM public.container_visits WHERE nullif(btrim(gate_out_driver_name), '') IS NOT NULL
), keyed AS (
  SELECT name,
         upper(regexp_replace(btrim(name), '\s+', ' ', 'g')) AS one_spelling,
         regexp_replace(
           left(lower(regexp_replace(name, '[^A-Za-z]', '', 'g')), 1)
           || regexp_replace(substr(lower(regexp_replace(name, '[^A-Za-z]', '', 'g')), 2), '[aeiouyhw]', '', 'g'),
           '(.)\1+', '\1', 'g') AS skeleton
    FROM names
   WHERE name ~ '[A-Za-z]'
)
SELECT skeleton,
       count(*)                      AS uses,
       count(DISTINCT one_spelling)  AS spellings,
       array_agg(DISTINCT one_spelling) AS variants
  FROM keyed
 GROUP BY skeleton
HAVING count(DISTINCT one_spelling) > 1
 ORDER BY uses DESC;

-- ── Suggested fixes: NOT run, review first ─────────────────────────────────
-- Each belongs in its own reviewed migration (or the Edit container dialog,
-- which logs a reason). Take a backup first.
--
-- a) Seals recorded as "0", "NULL" or "UNKNOWN" mean "no seal". Only after
--    Gate Out offers an explicit "No seal" choice:
--      UPDATE public.container_visits SET seal_number = NULL
--       WHERE upper(btrim(seal_number)) IN ('0', 'NULL', 'UNKNOWN');
--
-- b) Store existing driver names the way the gate forms now do
--    (trimmed, single-spaced, capitals); removes the case/spacing duplicates:
--      UPDATE public.container_visits
--         SET driver_name = upper(regexp_replace(btrim(driver_name), '\s+', ' ', 'g'))
--       WHERE driver_name IS DISTINCT FROM upper(regexp_replace(btrim(driver_name), '\s+', ' ', 'g'));
--      (and the same for gate_out_driver_name)
