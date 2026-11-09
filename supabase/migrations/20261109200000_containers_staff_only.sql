-- Containers are for staff: a signed-in account needs a yard on its profile,
-- or the super_admin role, to read or write them.
--
-- containers is the master list of boxes, one row per container_number,
-- shared by every yard. Gate-in at any yard looks a box up there and updates
-- its type and line, and the "already in a yard" check reads it across
-- yards; yard scoping lives on container_visits, payments and port data.
-- Its policies only asked "signed in and not a line rep" (insert, update)
-- and line_scope_ok (select, true for anyone who isn't a rep). So any
-- signed-in account could list every box in every yard, add boxes, and
-- change any box's type or shipping line, which moves the box between line
-- reps and changes its demurrage. That includes an account made through
-- public sign-up, which 20261109120000 leaves as a plain 'user' with no yard.
--
-- Nothing else gives such an account anything. Every other table scopes its
-- rows with yard_id = current_yard_id() (NULL without a yard) or a role,
-- container_demurrage is a security_invoker view over container_port_data,
-- and every SECURITY DEFINER function the API exposes checks for an admin or
-- a yard. shipping_lines stays readable by every signed-in account: it is
-- the reference list of line codes.
--
-- The fix is one RESTRICTIVE policy, ANDed with the permissive ones for
-- every command: the caller is a super admin or has a yard. Only the
-- create-user Edge Function or an admin sets a yard (prevent_role_change
-- stops anyone changing their own). Every account in production had a yard
-- when this was written (2026-11-09), so no one loses access, and what each
-- staff member sees and changes is exactly what it was.
--
-- It is a separate policy, not an edit of containers_select/insert/update,
-- because 20261011130000 (not yet applied in production) rewrites those
-- three by name and would undo an edit. It doesn't touch this one.
--
-- is_super_admin and current_yard_id live in public in production and in
-- private once 20261011120000 runs. The policy is created against whichever
-- schema holds them; a policy refers to a function by OID, so it keeps
-- working when 20261011120000 moves them afterwards.

DO $migration$
DECLARE
  _super regprocedure := coalesce(to_regprocedure('private.is_super_admin(uuid)'),
                                  to_regprocedure('public.is_super_admin(uuid)'));
  _yard  regprocedure := coalesce(to_regprocedure('private.current_yard_id()'),
                                  to_regprocedure('public.current_yard_id()'));
  _staff text;
BEGIN
  IF _super IS NULL OR _yard IS NULL THEN
    RAISE EXCEPTION 'is_super_admin(uuid) / current_yard_id() not found in private or public';
  END IF;

  -- (SELECT ...) makes each call an InitPlan, evaluated once per query
  -- rather than once per row (the same pattern as 20261011130000).
  _staff := format(
    '(SELECT %s.is_super_admin((SELECT auth.uid()))) OR ((SELECT %s.current_yard_id()) IS NOT NULL)',
    (SELECT quote_ident(n.nspname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.oid = _super),
    (SELECT quote_ident(n.nspname) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE p.oid = _yard));

  DROP POLICY IF EXISTS containers_staff_only ON public.containers;
  EXECUTE format(
    'CREATE POLICY containers_staff_only ON public.containers AS RESTRICTIVE FOR ALL TO authenticated '
    'USING (%s) WITH CHECK (%s)', _staff, _staff);
END
$migration$;
