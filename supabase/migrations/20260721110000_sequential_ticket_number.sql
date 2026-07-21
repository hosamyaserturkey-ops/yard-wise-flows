-- Reception/gate-out ticket numbers were derived from a hash of the visit's
-- UUID (deterministic but not sequential — hence numbers like #481944).
-- Replace with a real sequential counter shared by both tickets for a visit
-- (one reference number identifies the whole trip, in and out).
--
-- Backfill: the 9 already-recorded WOM visits get tickets 1-9 in gate-in
-- order, and the sequence continues from 10 for every new visit onward.

ALTER TABLE public.container_visits ADD COLUMN IF NOT EXISTS ticket_number integer;

WITH ranked AS (
  SELECT id, row_number() OVER (ORDER BY gate_in_time) AS rn
  FROM public.container_visits
  WHERE ticket_number IS NULL
)
UPDATE public.container_visits v
SET ticket_number = ranked.rn
FROM ranked
WHERE v.id = ranked.id;

CREATE SEQUENCE IF NOT EXISTS public.container_visit_ticket_seq;
SELECT setval('public.container_visit_ticket_seq', GREATEST(1, (SELECT COALESCE(max(ticket_number), 0) FROM public.container_visits)));
ALTER SEQUENCE public.container_visit_ticket_seq OWNED BY public.container_visits.ticket_number;

ALTER TABLE public.container_visits ALTER COLUMN ticket_number SET DEFAULT nextval('public.container_visit_ticket_seq');
ALTER TABLE public.container_visits ALTER COLUMN ticket_number SET NOT NULL;
ALTER TABLE public.container_visits ADD CONSTRAINT container_visits_ticket_number_unique UNIQUE (ticket_number);
