
-- 1. Drop old containers (empty) — this cascades any dependent FKs.
DROP TABLE IF EXISTS public.containers CASCADE;

-- 2. Recreate containers as master data (one row per physical container).
CREATE TABLE public.containers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  container_number text NOT NULL UNIQUE,
  container_type text NOT NULL,
  shipping_line text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.containers TO authenticated;
GRANT ALL ON public.containers TO service_role;
ALTER TABLE public.containers ENABLE ROW LEVEL SECURITY;
CREATE POLICY containers_select ON public.containers FOR SELECT TO authenticated USING (true);
CREATE POLICY containers_insert ON public.containers FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY containers_update ON public.containers FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY containers_delete ON public.containers FOR DELETE TO authenticated USING (public.is_super_admin(auth.uid()));
CREATE TRIGGER containers_updated_at BEFORE UPDATE ON public.containers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. Create container_visits — one row per yard stay of a container.
CREATE TABLE public.container_visits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  container_id uuid NOT NULL REFERENCES public.containers(id) ON DELETE CASCADE,
  yard_id uuid NOT NULL REFERENCES public.yards(id) ON DELETE CASCADE,
  gate_in_time timestamptz NOT NULL DEFAULT now(),
  gate_out_time timestamptz,
  status text NOT NULL DEFAULT 'in-yard' CHECK (status IN ('in-yard','out','reserved')),
  driver_name text,
  truck_number text,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  booking_number text,
  fees numeric,
  port_arrival_date date,
  free_days integer NOT NULL DEFAULT 7,
  daily_demurrage numeric,
  yard_block text,
  yard_row text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX container_visits_open_unique
  ON public.container_visits (container_id) WHERE gate_out_time IS NULL;
CREATE INDEX container_visits_yard_status_idx
  ON public.container_visits (yard_id, status);
CREATE INDEX container_visits_booking_id_idx
  ON public.container_visits (booking_id);
CREATE INDEX container_visits_container_id_idx
  ON public.container_visits (container_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.container_visits TO authenticated;
GRANT ALL ON public.container_visits TO service_role;
ALTER TABLE public.container_visits ENABLE ROW LEVEL SECURITY;

CREATE POLICY container_visits_select ON public.container_visits FOR SELECT TO authenticated
  USING (public.is_super_admin(auth.uid()) OR yard_id = public.current_yard_id());
CREATE POLICY container_visits_insert ON public.container_visits FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = created_by AND (public.is_super_admin(auth.uid()) OR yard_id = public.current_yard_id()));
CREATE POLICY container_visits_update ON public.container_visits FOR UPDATE TO authenticated
  USING (public.is_super_admin(auth.uid()) OR (yard_id = public.current_yard_id() AND (auth.uid() = created_by OR public.is_yard_admin(auth.uid(), yard_id))))
  WITH CHECK (public.is_super_admin(auth.uid()) OR (yard_id = public.current_yard_id() AND (auth.uid() = created_by OR public.is_yard_admin(auth.uid(), yard_id))));
CREATE POLICY container_visits_delete ON public.container_visits FOR DELETE TO authenticated
  USING (public.is_super_admin(auth.uid()) OR public.is_yard_admin(auth.uid(), yard_id));

CREATE TRIGGER container_visits_updated_at BEFORE UPDATE ON public.container_visits
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 4. shipping_lines lookup table.
CREATE TABLE public.shipping_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  contact_email text,
  default_free_days integer NOT NULL DEFAULT 7,
  default_daily_demurrage numeric,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.shipping_lines TO authenticated;
GRANT ALL ON public.shipping_lines TO service_role;
ALTER TABLE public.shipping_lines ENABLE ROW LEVEL SECURITY;
CREATE POLICY shipping_lines_select ON public.shipping_lines FOR SELECT TO authenticated USING (true);
CREATE POLICY shipping_lines_modify ON public.shipping_lines FOR ALL TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

INSERT INTO public.shipping_lines (code, name) VALUES
  ('SLD', 'Shipping Line D'),
  ('SLG', 'Shipping Line G');

-- 5. Drop any remaining shipping_line CHECK constraints on other tables (defensive).
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT conname, conrelid::regclass::text AS t
    FROM pg_constraint
    WHERE connamespace = 'public'::regnamespace
      AND contype = 'c'
      AND conname LIKE '%shipping_line%'
  LOOP
    EXECUTE format('ALTER TABLE %s DROP CONSTRAINT IF EXISTS %I', r.t, r.conname);
  END LOOP;
END $$;
