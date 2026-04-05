
-- 1. Create user_roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE(user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 2. Create has_role function
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- 3. Migrate existing roles from profiles to user_roles
INSERT INTO public.user_roles (user_id, role)
SELECT user_id, role FROM public.profiles
ON CONFLICT (user_id, role) DO NOTHING;

-- 4. RLS policies for user_roles: authenticated can read, only admins can modify
CREATE POLICY "Authenticated users can view roles"
ON public.user_roles FOR SELECT
USING (auth.uid() IS NOT NULL);

CREATE POLICY "Only admins can insert roles"
ON public.user_roles FOR INSERT
WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can update roles"
ON public.user_roles FOR UPDATE
USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can delete roles"
ON public.user_roles FOR DELETE
USING (public.has_role(auth.uid(), 'admin'));

-- 5. Update get_user_role to read from user_roles
CREATE OR REPLACE FUNCTION public.get_user_role(user_id UUID)
RETURNS app_role
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_roles.user_id = $1 LIMIT 1;
$$;

-- 6. Fix bookings UPDATE policy to owner-only + admin
DROP POLICY "Authenticated users can update bookings" ON public.bookings;

CREATE POLICY "Owners or admins can update bookings"
ON public.bookings FOR UPDATE
USING (auth.uid() = created_by OR public.has_role(auth.uid(), 'admin'));

-- 7. Fix containers UPDATE policy to owner-only + admin
DROP POLICY "Authenticated users can update containers" ON public.containers;

CREATE POLICY "Owners or admins can update containers"
ON public.containers FOR UPDATE
USING (auth.uid() = created_by OR public.has_role(auth.uid(), 'admin'));

-- 8. Restrict profile updates to exclude role column by replacing the policy
-- (Users can still update their own profile but we add a trigger to prevent role changes)
CREATE OR REPLACE FUNCTION public.prevent_role_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Cannot change role via profiles table';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER prevent_profile_role_change
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_role_change();
