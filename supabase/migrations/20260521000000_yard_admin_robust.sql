-- Make yard-admin checks robust: store yard_id on user_roles (single source
-- of truth for "who is admin/inspector of which yard"), and fall back to
-- profiles.yard_id so that pre-existing rows still resolve.

-- 1. Add yard_id column to user_roles. Nullable: super_admin and 'user' rows
--    don't necessarily have a yard.
ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS yard_id uuid REFERENCES public.yards(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_user_roles_yard_id ON public.user_roles(yard_id);

-- 2. Backfill from profiles where the role row has no yard_id yet.
UPDATE public.user_roles ur
   SET yard_id = p.yard_id
  FROM public.profiles p
 WHERE p.user_id = ur.user_id
   AND ur.yard_id IS NULL
   AND p.yard_id IS NOT NULL;

-- 3. Rewrite is_yard_admin to consult either source. This is the fix for
--    "yard admin can't create users": previously the check required BOTH the
--    user_roles row to be 'admin' AND profiles.yard_id to equal the target
--    yard. When an admin existed in user_roles but their profiles.yard_id
--    happened to be NULL (because their account predates the yard_id column
--    or was manually inserted), the function silently returned false and the
--    edge function returned 403 "Not a yard admin".
CREATE OR REPLACE FUNCTION public.is_yard_admin(_uid uuid, _yard uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
      FROM public.user_roles ur
 LEFT JOIN public.profiles p ON p.user_id = ur.user_id
     WHERE ur.user_id = _uid
       AND ur.role = 'admin'
       AND (ur.yard_id = _yard OR p.yard_id = _yard)
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_yard_admin(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_super_admin(uuid)      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_yard_id()         TO authenticated, service_role;

-- 4. Update handle_new_user to also stamp yard_id on the user_roles row, so
--    every newly created yard admin / inspector / user is immediately
--    discoverable as belonging to that yard regardless of what happens to
--    profiles.yard_id later.
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE _yard_id uuid; _role public.app_role;
BEGIN
  _yard_id := NULLIF(NEW.raw_user_meta_data ->> 'yard_id', '')::uuid;
  _role    := COALESCE(NULLIF(NEW.raw_user_meta_data ->> 'role', ''), 'user')::public.app_role;

  INSERT INTO public.profiles (user_id, full_name, username, role, yard_id)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data ->> 'full_name',
             NEW.raw_user_meta_data ->> 'username',
             NEW.email),
    NEW.raw_user_meta_data ->> 'username',
    _role,
    _yard_id
  );

  INSERT INTO public.user_roles (user_id, role, yard_id)
  VALUES (NEW.id, _role, _yard_id);

  RETURN NEW;
END;
$$;

-- 5. Update user_roles RLS so listing/inserting also works when only
--    user_roles.yard_id is set (the new source of truth) without requiring
--    profiles.yard_id.
DROP POLICY IF EXISTS "user_roles_select" ON public.user_roles;
CREATE POLICY "user_roles_select" ON public.user_roles FOR SELECT
USING (
  public.is_super_admin(auth.uid())
  OR user_id = auth.uid()
  OR (user_roles.yard_id IS NOT NULL
        AND public.is_yard_admin(auth.uid(), user_roles.yard_id))
  OR EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.user_id = user_roles.user_id
       AND p.yard_id IS NOT NULL
       AND public.is_yard_admin(auth.uid(), p.yard_id)
  )
);

DROP POLICY IF EXISTS "user_roles_insert" ON public.user_roles;
CREATE POLICY "user_roles_insert" ON public.user_roles FOR INSERT
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR (
    role <> 'super_admin'
    AND (
      (user_roles.yard_id IS NOT NULL
         AND public.is_yard_admin(auth.uid(), user_roles.yard_id))
      OR EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.user_id = user_roles.user_id
           AND p.yard_id IS NOT NULL
           AND public.is_yard_admin(auth.uid(), p.yard_id)
      )
    )
  )
);

DROP POLICY IF EXISTS "user_roles_update" ON public.user_roles;
CREATE POLICY "user_roles_update" ON public.user_roles FOR UPDATE
USING (
  public.is_super_admin(auth.uid())
  OR (user_roles.yard_id IS NOT NULL
        AND public.is_yard_admin(auth.uid(), user_roles.yard_id))
  OR EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.user_id = user_roles.user_id
       AND p.yard_id IS NOT NULL
       AND public.is_yard_admin(auth.uid(), p.yard_id)
  )
)
WITH CHECK (
  public.is_super_admin(auth.uid())
  OR (
    role <> 'super_admin'
    AND (
      (user_roles.yard_id IS NOT NULL
         AND public.is_yard_admin(auth.uid(), user_roles.yard_id))
      OR EXISTS (
        SELECT 1 FROM public.profiles p
         WHERE p.user_id = user_roles.user_id
           AND p.yard_id IS NOT NULL
           AND public.is_yard_admin(auth.uid(), p.yard_id)
      )
    )
  )
);

DROP POLICY IF EXISTS "user_roles_delete" ON public.user_roles;
CREATE POLICY "user_roles_delete" ON public.user_roles FOR DELETE
USING (
  public.is_super_admin(auth.uid())
  OR (user_roles.yard_id IS NOT NULL
        AND public.is_yard_admin(auth.uid(), user_roles.yard_id))
  OR EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.user_id = user_roles.user_id
       AND p.yard_id IS NOT NULL
       AND public.is_yard_admin(auth.uid(), p.yard_id)
  )
);

-- 6. Self-update policy on profiles previously had `WITH CHECK (... AND role
--    = 'user'::app_role ...)`, which blocked yard admins from editing their
--    own full_name / username. Role changes are still blocked by the
--    prevent_role_change trigger.
DROP POLICY IF EXISTS profiles_update_self ON public.profiles;
CREATE POLICY profiles_update_self ON public.profiles FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (
  auth.uid() = user_id
  AND yard_id IS NOT DISTINCT FROM (
        SELECT yard_id FROM public.profiles WHERE user_id = auth.uid()
      )
);
