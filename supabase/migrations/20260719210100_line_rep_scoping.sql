-- Line-rep scoping: a 'line_rep' user sees only data belonging to their
-- shipping line (containers, visits, port data, demurrage payments) and can
-- add/update port data for that line in their yard. Everything else is
-- hidden from them. Non-rep roles are unaffected by every change below.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS shipping_line text;

CREATE OR REPLACE FUNCTION public.is_line_rep(_uid uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = _uid AND role = 'line_rep'
  );
$$;

CREATE OR REPLACE FUNCTION public.rep_shipping_line(_uid uuid)
RETURNS text
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT p.shipping_line FROM public.profiles p WHERE p.user_id = _uid LIMIT 1;
$$;

-- True unless the caller is a line rep looking at another line's row.
CREATE OR REPLACE FUNCTION public.line_scope_ok(_line text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT NOT public.is_line_rep(auth.uid())
         OR (_line IS NOT NULL AND _line = public.rep_shipping_line(auth.uid()));
$$;

GRANT EXECUTE ON FUNCTION
  public.is_line_rep(uuid),
  public.rep_shipping_line(uuid),
  public.line_scope_ok(text)
TO authenticated;

-- Carry shipping_line from signup metadata (set by the create-user Edge
-- Function) into the profile row.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _yard_id uuid; _role public.app_role; _line text;
BEGIN
  _yard_id := NULLIF(NEW.raw_user_meta_data ->> 'yard_id', '')::uuid;
  _role := COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'role', ''), 'user')::public.app_role;
  _line := NULLIF(NEW.raw_user_meta_data ->> 'shipping_line', '');
  INSERT INTO public.profiles (user_id, full_name, username, role, yard_id, shipping_line)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', NEW.raw_user_meta_data ->> 'username', NEW.email),
    NEW.raw_user_meta_data ->> 'username',
    _role, _yard_id,
    CASE WHEN _role = 'line_rep' THEN _line END
  );
  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, _role);
  RETURN NEW;
END;
$$;

-- containers: reps only see their line; they never write containers.
ALTER POLICY containers_select ON public.containers
  USING (public.line_scope_ok(shipping_line));
ALTER POLICY containers_insert ON public.containers
  WITH CHECK (auth.uid() IS NOT NULL AND NOT public.is_line_rep(auth.uid()));
ALTER POLICY containers_update ON public.containers
  USING (auth.uid() IS NOT NULL AND NOT public.is_line_rep(auth.uid()))
  WITH CHECK (auth.uid() IS NOT NULL AND NOT public.is_line_rep(auth.uid()));

-- container_visits: reps see visits of their line's containers only; no writes.
ALTER POLICY container_visits_select ON public.container_visits
  USING (
    is_super_admin(auth.uid()) OR (
      yard_id = current_yard_id() AND (
        NOT public.is_line_rep(auth.uid()) OR EXISTS (
          SELECT 1 FROM public.containers c
          WHERE c.id = container_visits.container_id
            AND c.shipping_line = public.rep_shipping_line(auth.uid())
        )
      )
    )
  );
ALTER POLICY container_visits_insert ON public.container_visits
  WITH CHECK (
    (auth.uid() = created_by)
    AND NOT public.is_line_rep(auth.uid())
    AND (is_super_admin(auth.uid()) OR yard_id = current_yard_id())
  );

-- container_port_data: reps read their line and can add/update rows for
-- their own line in their yard (the whole point of the role).
ALTER POLICY cpd_select ON public.container_port_data
  USING (
    is_super_admin(auth.uid())
    OR (yard_id = current_yard_id() AND public.line_scope_ok(shipping_line))
  );
ALTER POLICY cpd_insert ON public.container_port_data
  WITH CHECK (
    is_super_admin(auth.uid()) OR (
      yard_id = current_yard_id() AND (
        is_yard_admin(auth.uid(), yard_id)
        OR (public.is_line_rep(auth.uid()) AND shipping_line = public.rep_shipping_line(auth.uid()))
      )
    )
  );
ALTER POLICY cpd_update ON public.container_port_data
  USING (
    is_super_admin(auth.uid()) OR (
      yard_id = current_yard_id() AND (
        is_yard_admin(auth.uid(), yard_id)
        OR (public.is_line_rep(auth.uid()) AND shipping_line = public.rep_shipping_line(auth.uid()))
      )
    )
  )
  WITH CHECK (
    is_super_admin(auth.uid()) OR (
      yard_id = current_yard_id() AND (
        is_yard_admin(auth.uid(), yard_id)
        OR (public.is_line_rep(auth.uid()) AND shipping_line = public.rep_shipping_line(auth.uid()))
      )
    )
  );

-- demurrage_payments: reps see their line's payment history; never write.
ALTER POLICY dp_select ON public.demurrage_payments
  USING (
    is_super_admin(auth.uid())
    OR (yard_id = current_yard_id() AND public.line_scope_ok(shipping_line))
  );
ALTER POLICY dp_insert ON public.demurrage_payments
  WITH CHECK (
    (auth.uid() = collected_by)
    AND NOT public.is_line_rep(auth.uid())
    AND (is_super_admin(auth.uid()) OR yard_id = current_yard_id())
  );

-- bookings / activity_log: yard-internal data, hidden from reps.
ALTER POLICY bookings_select ON public.bookings
  USING (
    is_super_admin(auth.uid())
    OR (yard_id = current_yard_id() AND NOT public.is_line_rep(auth.uid()))
  );
ALTER POLICY activity_log_select_yard ON public.activity_log
  USING (
    is_super_admin(auth.uid())
    OR (yard_id = current_yard_id() AND NOT public.is_line_rep(auth.uid()))
  );

-- profiles: reps see only their own profile, not the yard roster.
ALTER POLICY profiles_select ON public.profiles
  USING (
    is_super_admin(auth.uid())
    OR user_id = auth.uid()
    OR (yard_id IS NOT NULL AND yard_id = current_yard_id() AND NOT public.is_line_rep(auth.uid()))
  );
