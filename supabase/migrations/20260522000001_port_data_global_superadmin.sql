-- Port data is global (one record per container, shared across all yards)
-- and only super_admin may write it.

-- 1. Revert to single-column unique — port data belongs to a container, not a yard.
ALTER TABLE public.container_port_data
  DROP CONSTRAINT IF EXISTS container_port_data_container_number_yard_id_key;

ALTER TABLE public.container_port_data
  ADD CONSTRAINT container_port_data_container_number_key
  UNIQUE (container_number);

-- 2. Make yard_id nullable — super_admin has no yard_id, and port data is global anyway.
ALTER TABLE public.container_port_data
  ALTER COLUMN yard_id DROP NOT NULL;

-- 3. All authenticated users may read port data (global, no yard filter).
DROP POLICY IF EXISTS "cpd_select" ON public.container_port_data;
CREATE POLICY "cpd_select" ON public.container_port_data FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- 4. Only super_admin may insert / update / delete port data.
DROP POLICY IF EXISTS "cpd_insert" ON public.container_port_data;
DROP POLICY IF EXISTS "cpd_update" ON public.container_port_data;
DROP POLICY IF EXISTS "cpd_delete" ON public.container_port_data;

CREATE POLICY "cpd_insert" ON public.container_port_data FOR INSERT
  WITH CHECK (public.is_super_admin(auth.uid()));

CREATE POLICY "cpd_update" ON public.container_port_data FOR UPDATE
  USING (public.is_super_admin(auth.uid()));

CREATE POLICY "cpd_delete" ON public.container_port_data FOR DELETE
  USING (public.is_super_admin(auth.uid()));

-- 5. Update container_demurrage view: cap chargeable days at the earliest
--    gate-in time for that container so demurrage stops accruing once the
--    container has been picked up from the port.
CREATE OR REPLACE VIEW public.container_demurrage
WITH (security_invoker = true)
AS
SELECT
  cpd.container_number,
  cpd.shipping_line,
  cpd.port_arrival_date,
  cpd.free_days,
  cpd.daily_demurrage,
  (
    LEAST(
      COALESCE(
        (SELECT MIN(c.gate_in_time)::date
           FROM public.containers c
          WHERE c.container_number = cpd.container_number),
        CURRENT_DATE
      ),
      CURRENT_DATE
    ) - cpd.port_arrival_date
  ) AS days_from_arrival,
  GREATEST(0, (
    LEAST(
      COALESCE(
        (SELECT MIN(c.gate_in_time)::date
           FROM public.containers c
          WHERE c.container_number = cpd.container_number),
        CURRENT_DATE
      ),
      CURRENT_DATE
    ) - cpd.port_arrival_date - cpd.free_days
  )) AS chargeable_days,
  CASE
    WHEN cpd.daily_demurrage IS NULL THEN NULL
    ELSE GREATEST(0, (
      LEAST(
        COALESCE(
          (SELECT MIN(c.gate_in_time)::date
             FROM public.containers c
            WHERE c.container_number = cpd.container_number),
          CURRENT_DATE
        ),
        CURRENT_DATE
      ) - cpd.port_arrival_date - cpd.free_days
    ))::numeric * cpd.daily_demurrage
  END AS demurrage_amount
FROM public.container_port_data cpd;
