-- Containers: only a super admin, or staff of the yard the container is in,
-- can read or write a container row.
--
-- containers has no yard_id. Since 20260712200738 it holds one row per
-- physical box (number, type, line), shared by every yard; what ties a box
-- to a yard is its records there:
--   container_visits     (container_id, yard_id)   a gate-in, open or past
--   inspector_checks     (container_number, yard_id)
--   container_port_data  (container_number, yard_id) a port-list entry
-- private.container_in_other_yards (20261011120000) reads the same tables
-- from the other side.
--
-- The policies this replaces gave every signed-in account that is not a line
-- rep every yard's containers, and let it insert and update them:
--   containers_select  line_scope_ok(shipping_line)   (true for non-reps)
--   containers_insert  auth.uid() IS NOT NULL AND NOT is_line_rep(...)
--   containers_update  the same, USING and WITH CHECK
-- So a public sign-up (role 'user', no yard, since 20261109120000) could read
-- and write containers in every yard.
--
-- Now:
--   * A super admin reads and writes every container, as before.
--   * Anyone else needs a yard on their profile AND a role in user_roles that
--     works in it: admin, user (gate staff) or inspector to read and write,
--     line_rep to read. The yard is profiles.yard_id, as current_yard_id()
--     reads it; the role comes from user_roles, as every other policy reads
--     it. An account with no yard, or with a yard but no role, gets nothing.
--   * They see a container that has a visit, an inspection or a port-list
--     entry in their yard, or no visit in any yard yet. The last case is the
--     master row Gate In inserts just before the visit: the app inserts it
--     with .select("id"), and INSERT ... RETURNING has to pass this SELECT
--     policy, so without it an admin gating in a brand-new box with no
--     inspection or port-list entry would be refused. It also lets a gate-in
--     that failed after inserting the row be retried. Such a row carries a
--     number, type and line, and nothing about any yard.
--   * Line reps additionally see only their own line, as before (and now only
--     in their own yard, like every other table they read).
--   * Insert: super admin, or staff (admin, user, inspector) with a yard.
--     The new row has no visit yet, so it is visible to them (see above).
--   * Update: super admin, or staff whose yard the container is in. Gate In
--     updates the type and line of a box it has seen before; that box has an
--     approved inspection in this yard (gate staff) or is being gated in by
--     an admin. admin_edit_container, admin_delete_container and
--     rename_container are SECURITY DEFINER and do their own role and yard
--     checks, so they are unaffected.
--   * Delete stays super admin only (containers_delete, unchanged).
--
-- What the app does with containers (src/), checked before this change:
--   reads   GateIn.tsx, useContainerLookup.ts, ContainerDetailDialog.tsx:
--             one row by number, to find its id. usePortList.ts: ids for the
--             numbers on this yard's port list. containerMap.ts, YardMap.tsx,
--             CommandPalette.tsx, Inspector.tsx, usePendingGateIns.ts:
--             containers!inner(...) embedded in a container_visits query,
--             which only returns this yard's visits.
--   writes  GateIn.tsx insertContainer only: insert the master row (with
--             .select("id")) or update its type and line, then insert the
--             visit. Gate Out, bookings and inspections never write it; admin
--             edit, rename and delete go through the RPCs above.
-- Every one of those rows is linked to the caller's yard by the time the app
-- reads it, so nothing the app does changes. One case to know about once a
-- second yard exists: an admin gating in, with no inspection or port-list
-- entry in their yard, a box that has only ever been in another yard cannot
-- see its master row, so Gate In tries to insert it again and gets a
-- duplicate-number error. Inspect it (or put it on the port list) first.
--
-- The checks live in SECURITY DEFINER functions rather than in the policies
-- because container_visits_select and inspector_checks_select query
-- containers: a containers policy that queried those tables back would make
-- Postgres stop with "infinite recursion detected in policy". The functions
-- read the tables as their owner, so no policy is expanded inside them.
--
-- Works with the RLS helpers in either schema. Production still has
-- has_role, is_super_admin, current_yard_id, ... in public (20261011120000
-- and 20261011130000 not applied yet); the repo has them in private. The new
-- functions read profiles and user_roles directly and the policies call only
-- them, so nothing here names a helper that 20261011120000 moves. That
-- migration creates the private schema with the same statements as below.
-- 20261011130000 used to rewrite containers_insert, containers_update and
-- profiles_insert_self too; those lines are gone from it, so applying it
-- after this migration doesn't put the old expressions back.
--
-- Also: profiles_insert_self let an account insert its own profile row with
-- any yard_id. Every account gets its profile from handle_new_user, and
-- profiles.user_id is unique, so this only mattered once the row was gone
-- (an admin can delete profiles of their yard). Then the account could
-- re-create it in any yard and pass current_yard_id() everywhere. The app
-- never inserts profiles itself (handle_new_user and the create-user Edge
-- Function bypass RLS), so a self-inserted row is now held to role 'user',
-- no yard and no line.
--
-- Check: supabase/checks/yard_scoped_access.sql.

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC;
GRANT USAGE ON SCHEMA private TO authenticated, service_role;

-- ── Helpers ──────────────────────────────────────────────────────────────────
-- They answer for the caller only (auth.uid()), never for a user id passed
-- in, so they reveal nothing about other accounts.

-- The caller's yard, when user_roles gives them one of _roles. NULL when
-- their profile has no yard or they hold none of those roles.
CREATE OR REPLACE FUNCTION private.caller_yard_with_role(_roles public.app_role[])
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT p.yard_id
    FROM public.profiles p
   WHERE p.user_id = auth.uid()
     AND EXISTS (SELECT 1 FROM public.user_roles r
                  WHERE r.user_id = auth.uid() AND r.role = ANY (_roles));
$function$;

CREATE OR REPLACE FUNCTION private.caller_has_role(_role public.app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT EXISTS (SELECT 1 FROM public.user_roles
                  WHERE user_id = auth.uid() AND role = _role);
$function$;

-- A line rep's line (profiles.shipping_line).
CREATE OR REPLACE FUNCTION private.caller_shipping_line()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT shipping_line FROM public.profiles WHERE user_id = auth.uid();
$function$;

-- True when the container has a visit, an inspection or a port-list entry in
-- _yard_id, or no visit in any yard yet. False when _yard_id is NULL.
CREATE OR REPLACE FUNCTION private.container_in_yard(_container_id uuid, _container_number text, _yard_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  SELECT _yard_id IS NOT NULL AND (
       EXISTS (SELECT 1 FROM public.container_visits
                WHERE container_id = _container_id AND yard_id = _yard_id)
    OR EXISTS (SELECT 1 FROM public.inspector_checks
                WHERE container_number = _container_number AND yard_id = _yard_id)
    OR EXISTS (SELECT 1 FROM public.container_port_data
                WHERE container_number = _container_number AND yard_id = _yard_id)
    OR NOT EXISTS (SELECT 1 FROM public.container_visits
                    WHERE container_id = _container_id)
  );
$function$;

REVOKE ALL ON FUNCTION private.caller_yard_with_role(public.app_role[])     FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.caller_has_role(public.app_role)             FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.caller_shipping_line()                       FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION private.container_in_yard(uuid, text, uuid)          FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.caller_yard_with_role(public.app_role[])  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.caller_has_role(public.app_role)          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.caller_shipping_line()                    TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.container_in_yard(uuid, text, uuid)       TO authenticated, service_role;

-- container_in_yard looks inspections up by number and yard. The table had
-- no index on container_number (622 rows today), and the line-rep branches
-- of container_visits_select / inspector_checks_select join on it too.
CREATE INDEX IF NOT EXISTS inspector_checks_container_number_yard_idx
  ON public.inspector_checks (container_number, yard_id);

-- ── Policies ─────────────────────────────────────────────────────────────────
-- Names, roles (authenticated) and commands stay as they are. The caller's
-- role and yard are wrapped in (SELECT ...) so they are worked out once per
-- query; only container_in_yard runs per row.

ALTER POLICY containers_select ON public.containers
  USING (
    (SELECT private.caller_has_role('super_admin'))
    OR (
      private.container_in_yard(id, container_number,
        (SELECT private.caller_yard_with_role('{admin,user,inspector,line_rep}'::public.app_role[])))
      AND (NOT (SELECT private.caller_has_role('line_rep'))
           OR lower(shipping_line) = lower((SELECT private.caller_shipping_line())))
    )
  );

ALTER POLICY containers_insert ON public.containers
  WITH CHECK (
    (SELECT private.caller_has_role('super_admin'))
    OR (
      (SELECT private.caller_yard_with_role('{admin,user,inspector}'::public.app_role[])) IS NOT NULL
      AND NOT (SELECT private.caller_has_role('line_rep'))
    )
  );

ALTER POLICY containers_update ON public.containers
  USING (
    (SELECT private.caller_has_role('super_admin'))
    OR (
      NOT (SELECT private.caller_has_role('line_rep'))
      AND private.container_in_yard(id, container_number,
            (SELECT private.caller_yard_with_role('{admin,user,inspector}'::public.app_role[])))
    )
  )
  WITH CHECK (
    (SELECT private.caller_has_role('super_admin'))
    OR (
      NOT (SELECT private.caller_has_role('line_rep'))
      AND private.container_in_yard(id, container_number,
            (SELECT private.caller_yard_with_role('{admin,user,inspector}'::public.app_role[])))
    )
  );

ALTER POLICY profiles_insert_self ON public.profiles
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND role = 'user'::public.app_role
    AND yard_id IS NULL
    AND shipping_line IS NULL
  );
