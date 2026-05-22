-- 1. Replace single-column unique constraint on container_number with a
--    composite constraint (container_number, yard_id) so the same container
--    can exist in multiple yards without a conflict.
ALTER TABLE public.container_port_data
  DROP CONSTRAINT IF EXISTS container_port_data_container_number_key;

ALTER TABLE public.container_port_data
  ADD CONSTRAINT container_port_data_container_number_yard_id_key
  UNIQUE (container_number, yard_id);

-- 2. Make daily_demurrage nullable — actual billing uses tiered rules in
--    DEMURRAGE_RULES, so this column is informational only. Many real-world
--    import files (e.g. overdue reports) don't include a per-day rate.
ALTER TABLE public.container_port_data
  ALTER COLUMN daily_demurrage DROP NOT NULL;

-- 3. Update the container_demurrage view to guard against NULL daily_demurrage.
CREATE OR REPLACE VIEW public.container_demurrage
WITH (security_invoker = true)
AS
SELECT
  container_number,
  shipping_line,
  port_arrival_date,
  free_days,
  daily_demurrage,
  (CURRENT_DATE - port_arrival_date) AS days_from_arrival,
  GREATEST(0, ((CURRENT_DATE - port_arrival_date) - free_days)) AS chargeable_days,
  CASE
    WHEN daily_demurrage IS NULL THEN NULL
    ELSE (GREATEST(0, ((CURRENT_DATE - port_arrival_date) - free_days)))::numeric * daily_demurrage
  END AS demurrage_amount
FROM public.container_port_data;
