-- A line rep whose profile stores a differently-cased shipping line code sees
-- nothing at all.
--
-- The create-user Edge Function uppercased the code before saving it, so the
-- 7Seas representative was stored as '7SEAS' while every container, port data
-- and demurrage row spells the line '7Seas'. Line scoping compares those two
-- text values for equality, so "My Containers" (and Port Data, and the
-- demurrage history) came back empty for that rep. WOM and EEL reps were
-- unaffected only because their codes are already all-caps.
--
-- Three changes, in order of how permanent they are:
--   1. canonicalise the codes already stored on profiles;
--   2. keep future writes canonical, whichever path sets them;
--   3. compare lines case-insensitively so a stray spelling can never blank a
--      rep's whole view again.

-- 1. Repair stored profiles: adopt the exact spelling from shipping_lines.
UPDATE public.profiles p
SET shipping_line = sl.code
FROM public.shipping_lines sl
WHERE p.shipping_line IS NOT NULL
  AND lower(p.shipping_line) = lower(sl.code)
  AND p.shipping_line <> sl.code;

-- 2a. Canonicalise on every write to profiles.shipping_line. A code with no
--     match in shipping_lines is left as typed — this trigger fixes spelling,
--     it does not police which lines exist.
CREATE OR REPLACE FUNCTION public.canonicalize_profile_shipping_line()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  NEW.shipping_line := NULLIF(btrim(NEW.shipping_line), '');
  IF NEW.shipping_line IS NOT NULL THEN
    NEW.shipping_line := COALESCE(
      (SELECT sl.code FROM public.shipping_lines sl
        WHERE lower(sl.code) = lower(NEW.shipping_line) LIMIT 1),
      NEW.shipping_line
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_canonicalize_shipping_line ON public.profiles;
CREATE TRIGGER profiles_canonicalize_shipping_line
  BEFORE INSERT OR UPDATE OF shipping_line ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.canonicalize_profile_shipping_line();

-- 2b. New signups go through the same lookup, so a rep created from stale
--     client code still lands on the canonical code.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _yard_id uuid; _role public.app_role; _line text;
BEGIN
  _yard_id := NULLIF(NEW.raw_user_meta_data ->> 'yard_id', '')::uuid;
  _role := COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'role', ''), 'user')::public.app_role;
  _line := NULLIF(btrim(NEW.raw_user_meta_data ->> 'shipping_line'), '');
  IF _line IS NOT NULL THEN
    _line := COALESCE(
      (SELECT sl.code FROM public.shipping_lines sl
        WHERE lower(sl.code) = lower(_line) LIMIT 1),
      _line
    );
  END IF;
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

-- 3. Match lines case-insensitively everywhere scoping is decided. No two
--    shipping_lines codes differ only by case, so this widens nothing: a rep
--    still sees exactly one line's rows.
CREATE OR REPLACE FUNCTION public.line_scope_ok(_line text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT NOT public.is_line_rep(auth.uid())
         OR (_line IS NOT NULL
             AND lower(_line) = lower(public.rep_shipping_line(auth.uid())));
$$;

-- container_visits and inspector_checks compared the code inline; route them
-- through the same helper so there is one rule, not three.
ALTER POLICY container_visits_select ON public.container_visits
  USING (
    is_super_admin(auth.uid()) OR (
      yard_id = current_yard_id() AND (
        NOT public.is_line_rep(auth.uid()) OR EXISTS (
          SELECT 1 FROM public.containers c
          WHERE c.id = container_visits.container_id
            AND public.line_scope_ok(c.shipping_line)
        )
      )
    )
  );

ALTER POLICY inspector_checks_select ON public.inspector_checks
  USING (
    is_super_admin(auth.uid()) OR (
      yard_id IS NOT NULL AND yard_id = current_yard_id() AND (
        NOT public.is_line_rep(auth.uid()) OR EXISTS (
          SELECT 1 FROM public.containers c
          WHERE c.container_number = inspector_checks.container_number
            AND public.line_scope_ok(c.shipping_line)
        )
      )
    )
  );

-- Port data writes by a rep follow the same comparison.
ALTER POLICY cpd_insert ON public.container_port_data
  WITH CHECK (
    is_super_admin(auth.uid()) OR (
      yard_id = current_yard_id() AND (
        is_yard_admin(auth.uid(), yard_id)
        OR (public.is_line_rep(auth.uid()) AND public.line_scope_ok(shipping_line))
      )
    )
  );
ALTER POLICY cpd_update ON public.container_port_data
  USING (
    is_super_admin(auth.uid()) OR (
      yard_id = current_yard_id() AND (
        is_yard_admin(auth.uid(), yard_id)
        OR (public.is_line_rep(auth.uid()) AND public.line_scope_ok(shipping_line))
      )
    )
  )
  WITH CHECK (
    is_super_admin(auth.uid()) OR (
      yard_id = current_yard_id() AND (
        is_yard_admin(auth.uid(), yard_id)
        OR (public.is_line_rep(auth.uid()) AND public.line_scope_ok(shipping_line))
      )
    )
  );
