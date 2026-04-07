-- 1. Enable RLS on container_port_data
ALTER TABLE public.container_port_data ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read container port data
CREATE POLICY "Authenticated users can view container port data"
  ON public.container_port_data FOR SELECT
  TO public
  USING (auth.uid() IS NOT NULL);

-- Allow authenticated users to insert container port data
CREATE POLICY "Authenticated users can insert container port data"
  ON public.container_port_data FOR INSERT
  TO public
  WITH CHECK (auth.uid() IS NOT NULL);

-- Allow authenticated users to update container port data
CREATE POLICY "Authenticated users can update container port data"
  ON public.container_port_data FOR UPDATE
  TO public
  USING (auth.uid() IS NOT NULL);

-- 2. Fix security definer view - recreate as SECURITY INVOKER
DROP VIEW IF EXISTS public.container_demurrage;
CREATE VIEW public.container_demurrage
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
  ((GREATEST(0, ((CURRENT_DATE - port_arrival_date) - free_days)))::numeric * daily_demurrage) AS demurrage_amount
FROM container_port_data p;