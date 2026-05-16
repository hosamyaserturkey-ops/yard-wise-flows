-- 1. WIPE DATA
DELETE FROM public.edi_transmissions;
DELETE FROM public.shipping_line_transfers;
DELETE FROM public.demurrage_payments;
DELETE FROM public.containers;
DELETE FROM public.container_port_data;
DELETE FROM public.bookings;
DELETE FROM public.user_roles;
DELETE FROM public.profiles;
DELETE FROM auth.users;

-- 2. YARDS TABLE
CREATE TABLE public.yards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text NOT NULL UNIQUE,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.yards ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER yards_updated_at BEFORE UPDATE ON public.yards
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 3. yard_id COLUMNS
ALTER TABLE public.profiles                ADD COLUMN yard_id uuid REFERENCES public.yards(id) ON DELETE SET NULL;
ALTER TABLE public.containers              ADD COLUMN yard_id uuid NOT NULL REFERENCES public.yards(id) ON DELETE CASCADE;
ALTER TABLE public.bookings                ADD COLUMN yard_id uuid NOT NULL REFERENCES public.yards(id) ON DELETE CASCADE;
ALTER TABLE public.container_port_data     ADD COLUMN yard_id uuid NOT NULL REFERENCES public.yards(id) ON DELETE CASCADE;
ALTER TABLE public.demurrage_payments      ADD COLUMN yard_id uuid NOT NULL REFERENCES public.yards(id) ON DELETE CASCADE;
ALTER TABLE public.shipping_line_transfers ADD COLUMN yard_id uuid NOT NULL REFERENCES public.yards(id) ON DELETE CASCADE;
ALTER TABLE public.edi_transmissions       ADD COLUMN yard_id uuid NOT NULL REFERENCES public.yards(id) ON DELETE CASCADE;

CREATE INDEX idx_profiles_yard_id                ON public.profiles(yard_id);
CREATE INDEX idx_containers_yard_id              ON public.containers(yard_id);
CREATE INDEX idx_bookings_yard_id                ON public.bookings(yard_id);
CREATE INDEX idx_container_port_data_yard_id     ON public.container_port_data(yard_id);
CREATE INDEX idx_demurrage_payments_yard_id      ON public.demurrage_payments(yard_id);
CREATE INDEX idx_shipping_line_transfers_yard_id ON public.shipping_line_transfers(yard_id);
CREATE INDEX idx_edi_transmissions_yard_id       ON public.edi_transmissions(yard_id);

-- 4. HELPERS
CREATE OR REPLACE FUNCTION public.is_super_admin(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'super_admin'); $$;

CREATE OR REPLACE FUNCTION public.current_yard_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$ SELECT yard_id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1; $$;

CREATE OR REPLACE FUNCTION public.is_yard_admin(_uid uuid, _yard uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    JOIN public.profiles p ON p.user_id = ur.user_id
    WHERE ur.user_id = _uid AND ur.role = 'admin' AND p.yard_id = _yard
  );
$$;

-- 5. handle_new_user
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _yard_id uuid; _role public.app_role;
BEGIN
  _yard_id := NULLIF(NEW.raw_user_meta_data ->> 'yard_id', '')::uuid;
  _role := COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'role', ''), 'user')::public.app_role;
  INSERT INTO public.profiles (user_id, full_name, username, role, yard_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'username', NEW.email),
    NEW.raw_user_meta_data ->> 'username',
    _role, _yard_id
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _role);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 6. RLS POLICIES

-- yards
CREATE POLICY "yards_select" ON public.yards FOR SELECT
  USING (public.is_super_admin(auth.uid()) OR id = public.current_yard_id());
CREATE POLICY "yards_insert_super" ON public.yards FOR INSERT
  WITH CHECK (public.is_super_admin(auth.uid()) AND created_by = auth.uid());
CREATE POLICY "yards_update_super" ON public.yards FOR UPDATE
  USING (public.is_super_admin(auth.uid())) WITH CHECK (public.is_super_admin(auth.uid()));
CREATE POLICY "yards_delete_super" ON public.yards FOR DELETE
  USING (public.is_super_admin(auth.uid()));

-- profiles
DROP POLICY IF EXISTS "Admins can delete profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins can update any profile" ON public.profiles;
DROP POLICY IF EXISTS "Authenticated users can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can update their own profile" ON public.profiles;

CREATE POLICY "profiles_select" ON public.profiles FOR SELECT
  USING (
    public.is_super_admin(auth.uid())
    OR user_id = auth.uid()
    OR (yard_id IS NOT NULL AND yard_id = public.current_yard_id())
  );
CREATE POLICY "profiles_insert_self" ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "profiles_update_self" ON public.profiles FOR UPDATE
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id AND role = 'user');
CREATE POLICY "profiles_update_admin" ON public.profiles FOR UPDATE
  USING (public.is_super_admin(auth.uid()) OR (yard_id IS NOT NULL AND public.is_yard_admin(auth.uid(), yard_id)))
  WITH CHECK (public.is_super_admin(auth.uid()) OR (yard_id IS NOT NULL AND public.is_yard_admin(auth.uid(), yard_id)));
CREATE POLICY "profiles_delete_admin" ON public.profiles FOR DELETE
  USING (public.is_super_admin(auth.uid()) OR (yard_id IS NOT NULL AND public.is_yard_admin(auth.uid(), yard_id)));

-- user_roles
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Only admins can delete roles" ON public.user_roles;
DROP POLICY IF EXISTS "Only admins can insert roles" ON public.user_roles;
DROP POLICY IF EXISTS "Only admins can update roles" ON public.user_roles;
DROP POLICY IF EXISTS "Users can view own role" ON public.user_roles;

CREATE POLICY "user_roles_select" ON public.user_roles FOR SELECT
  USING (
    public.is_super_admin(auth.uid())
    OR user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = user_roles.user_id AND p.yard_id IS NOT NULL AND public.is_yard_admin(auth.uid(), p.yard_id))
  );
CREATE POLICY "user_roles_insert" ON public.user_roles FOR INSERT
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR (role <> 'super_admin' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = user_roles.user_id AND p.yard_id IS NOT NULL AND public.is_yard_admin(auth.uid(), p.yard_id)))
  );
CREATE POLICY "user_roles_update" ON public.user_roles FOR UPDATE
  USING (
    public.is_super_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = user_roles.user_id AND p.yard_id IS NOT NULL AND public.is_yard_admin(auth.uid(), p.yard_id))
  )
  WITH CHECK (
    public.is_super_admin(auth.uid())
    OR (role <> 'super_admin' AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = user_roles.user_id AND p.yard_id IS NOT NULL AND public.is_yard_admin(auth.uid(), p.yard_id)))
  );
CREATE POLICY "user_roles_delete" ON public.user_roles FOR DELETE
  USING (
    public.is_super_admin(auth.uid())
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.user_id = user_roles.user_id AND p.yard_id IS NOT NULL AND public.is_yard_admin(auth.uid(), p.yard_id))
  );

-- bookings
DROP POLICY IF EXISTS "Admins can delete bookings" ON public.bookings;
DROP POLICY IF EXISTS "Authenticated users can create bookings" ON public.bookings;
DROP POLICY IF EXISTS "Authenticated users can view all bookings" ON public.bookings;
DROP POLICY IF EXISTS "Owners or admins can update bookings" ON public.bookings;

CREATE POLICY "bookings_select" ON public.bookings FOR SELECT
  USING (public.is_super_admin(auth.uid()) OR yard_id = public.current_yard_id());
CREATE POLICY "bookings_insert" ON public.bookings FOR INSERT
  WITH CHECK (auth.uid() = created_by AND (public.is_super_admin(auth.uid()) OR yard_id = public.current_yard_id()));
CREATE POLICY "bookings_update" ON public.bookings FOR UPDATE
  USING (public.is_super_admin(auth.uid()) OR (yard_id = public.current_yard_id() AND (auth.uid() = created_by OR public.is_yard_admin(auth.uid(), yard_id))));
CREATE POLICY "bookings_delete" ON public.bookings FOR DELETE
  USING (public.is_super_admin(auth.uid()) OR public.is_yard_admin(auth.uid(), yard_id));

-- containers
DROP POLICY IF EXISTS "Admins can delete containers" ON public.containers;
DROP POLICY IF EXISTS "Authenticated users can create containers" ON public.containers;
DROP POLICY IF EXISTS "Authenticated users can view all containers" ON public.containers;
DROP POLICY IF EXISTS "Owners or admins can update containers" ON public.containers;

CREATE POLICY "containers_select" ON public.containers FOR SELECT
  USING (public.is_super_admin(auth.uid()) OR yard_id = public.current_yard_id());
CREATE POLICY "containers_insert" ON public.containers FOR INSERT
  WITH CHECK (auth.uid() = created_by AND (public.is_super_admin(auth.uid()) OR yard_id = public.current_yard_id()));
CREATE POLICY "containers_update" ON public.containers FOR UPDATE
  USING (public.is_super_admin(auth.uid()) OR (yard_id = public.current_yard_id() AND (auth.uid() = created_by OR public.is_yard_admin(auth.uid(), yard_id))));
CREATE POLICY "containers_delete" ON public.containers FOR DELETE
  USING (public.is_super_admin(auth.uid()) OR public.is_yard_admin(auth.uid(), yard_id));

-- container_port_data
DROP POLICY IF EXISTS "Admins can insert container port data" ON public.container_port_data;
DROP POLICY IF EXISTS "Admins can update container port data" ON public.container_port_data;
DROP POLICY IF EXISTS "Authenticated users can view container port data" ON public.container_port_data;

CREATE POLICY "cpd_select" ON public.container_port_data FOR SELECT
  USING (public.is_super_admin(auth.uid()) OR yard_id = public.current_yard_id());
CREATE POLICY "cpd_insert" ON public.container_port_data FOR INSERT
  WITH CHECK (public.is_super_admin(auth.uid()) OR (yard_id = public.current_yard_id() AND public.is_yard_admin(auth.uid(), yard_id)));
CREATE POLICY "cpd_update" ON public.container_port_data FOR UPDATE
  USING (public.is_super_admin(auth.uid()) OR (yard_id = public.current_yard_id() AND public.is_yard_admin(auth.uid(), yard_id)))
  WITH CHECK (public.is_super_admin(auth.uid()) OR (yard_id = public.current_yard_id() AND public.is_yard_admin(auth.uid(), yard_id)));
CREATE POLICY "cpd_delete" ON public.container_port_data FOR DELETE
  USING (public.is_super_admin(auth.uid()) OR public.is_yard_admin(auth.uid(), yard_id));

-- demurrage_payments
DROP POLICY IF EXISTS "Admins can update demurrage payments" ON public.demurrage_payments;
DROP POLICY IF EXISTS "Authenticated users can insert demurrage payments" ON public.demurrage_payments;
DROP POLICY IF EXISTS "Authenticated users can view demurrage payments" ON public.demurrage_payments;

CREATE POLICY "dp_select" ON public.demurrage_payments FOR SELECT
  USING (public.is_super_admin(auth.uid()) OR yard_id = public.current_yard_id());
CREATE POLICY "dp_insert" ON public.demurrage_payments FOR INSERT
  WITH CHECK (auth.uid() = collected_by AND (public.is_super_admin(auth.uid()) OR yard_id = public.current_yard_id()));
CREATE POLICY "dp_update" ON public.demurrage_payments FOR UPDATE
  USING (public.is_super_admin(auth.uid()) OR public.is_yard_admin(auth.uid(), yard_id))
  WITH CHECK (public.is_super_admin(auth.uid()) OR public.is_yard_admin(auth.uid(), yard_id));

-- shipping_line_transfers
DROP POLICY IF EXISTS "Admins can insert transfers" ON public.shipping_line_transfers;
DROP POLICY IF EXISTS "Authenticated users can view transfers" ON public.shipping_line_transfers;

CREATE POLICY "slt_select" ON public.shipping_line_transfers FOR SELECT
  USING (public.is_super_admin(auth.uid()) OR yard_id = public.current_yard_id());
CREATE POLICY "slt_insert" ON public.shipping_line_transfers FOR INSERT
  WITH CHECK (auth.uid() = transferred_by AND (public.is_super_admin(auth.uid()) OR (yard_id = public.current_yard_id() AND public.is_yard_admin(auth.uid(), yard_id))));

-- edi_transmissions
DROP POLICY IF EXISTS "Admins can delete EDI transmissions" ON public.edi_transmissions;
DROP POLICY IF EXISTS "Admins can insert EDI transmissions" ON public.edi_transmissions;
DROP POLICY IF EXISTS "Admins can update EDI transmissions" ON public.edi_transmissions;
DROP POLICY IF EXISTS "Admins can view EDI transmissions" ON public.edi_transmissions;

CREATE POLICY "edi_select" ON public.edi_transmissions FOR SELECT
  USING (public.is_super_admin(auth.uid()) OR (yard_id = public.current_yard_id() AND public.is_yard_admin(auth.uid(), yard_id)));
CREATE POLICY "edi_insert" ON public.edi_transmissions FOR INSERT
  WITH CHECK (public.is_super_admin(auth.uid()) OR (yard_id = public.current_yard_id() AND public.is_yard_admin(auth.uid(), yard_id)));
CREATE POLICY "edi_update" ON public.edi_transmissions FOR UPDATE
  USING (public.is_super_admin(auth.uid()) OR (yard_id = public.current_yard_id() AND public.is_yard_admin(auth.uid(), yard_id)))
  WITH CHECK (public.is_super_admin(auth.uid()) OR (yard_id = public.current_yard_id() AND public.is_yard_admin(auth.uid(), yard_id)));
CREATE POLICY "edi_delete" ON public.edi_transmissions FOR DELETE
  USING (public.is_super_admin(auth.uid()) OR (yard_id = public.current_yard_id() AND public.is_yard_admin(auth.uid(), yard_id)));