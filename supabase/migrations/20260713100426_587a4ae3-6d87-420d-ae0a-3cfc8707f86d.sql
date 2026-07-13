
DROP POLICY IF EXISTS containers_insert ON public.containers;
DROP POLICY IF EXISTS containers_update ON public.containers;

CREATE POLICY containers_insert ON public.containers FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY containers_update ON public.containers FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);
