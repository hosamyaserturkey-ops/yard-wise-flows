-- Database performance fixes from the Supabase performance advisor.
--
-- 1. RLS policies called auth.uid() and the role helpers once per row. Each
--    helper is a SECURITY DEFINER lookup on user_roles / profiles that Postgres
--    can't inline, so scanning a few hundred containers ran a few hundred of
--    them. Wrapping a call in (SELECT ...) makes it an InitPlan, evaluated once
--    per query. Done for auth.uid() everywhere (lint 0003, 43 policies) and for
--    the helpers whose arguments don't depend on the row: is_super_admin,
--    is_line_rep, has_role and current_yard_id. is_yard_admin(uid, yard_id),
--    line_scope_ok(shipping_line) and has_approved_inspection_for_trip(...) take
--    a column, so they stay per row with only auth.uid() inside them wrapped.
--    ALTER POLICY keeps every policy's name, roles and command; only the
--    expressions change, and they mean the same thing.
--    One knock-on: the self-edit rule on profiles compared the new row with the
--    caller's stored yard, username and line by reading profiles inside a
--    profiles policy. Once profiles' SELECT policy contains (SELECT ...) too,
--    Postgres rejects that as infinite recursion, so the comparison moves into
--    private.own_profile_identity_unchanged().
-- 2. Two tables had two permissive policies for the same role and action, so
--    both ran for every row (lint 0006). Postgres ORs permissive policies'
--    USING clauses together and their WITH CHECK clauses together, so the
--    merged policies below allow exactly what the pairs did.
-- 3. Indexes for the five foreign keys without one (lint 0001), and one copy of
--    a duplicated index dropped (lint 0009). The tables hold a few hundred rows,
--    so the builds take milliseconds.
--
-- Run after 20261011120000_lock_down_security_definer_functions.sql, which
-- moved the helpers to the private schema.

-- ── 1. Evaluate auth.uid() and the constant role checks once per query ─────


ALTER POLICY amc_select ON public.accounting_month_closes
  USING (((SELECT private.is_super_admin((SELECT auth.uid()))) OR private.is_yard_admin((SELECT auth.uid()), yard_id)));

ALTER POLICY activity_log_insert_own ON public.activity_log
  WITH CHECK (((user_id = (SELECT auth.uid())) AND ((SELECT private.is_super_admin((SELECT auth.uid()))) OR (yard_id = (SELECT private.current_yard_id())))));
ALTER POLICY activity_log_select_yard ON public.activity_log
  USING (((SELECT private.is_super_admin((SELECT auth.uid()))) OR ((yard_id = (SELECT private.current_yard_id())) AND (NOT (SELECT private.is_line_rep((SELECT auth.uid())))))));

ALTER POLICY bookings_delete ON public.bookings
  USING (((SELECT private.is_super_admin((SELECT auth.uid()))) OR private.is_yard_admin((SELECT auth.uid()), yard_id)));
ALTER POLICY bookings_insert ON public.bookings
  WITH CHECK ((((SELECT auth.uid()) = created_by) AND ((SELECT private.is_super_admin((SELECT auth.uid()))) OR (yard_id = (SELECT private.current_yard_id())))));
ALTER POLICY bookings_select ON public.bookings
  USING (((SELECT private.is_super_admin((SELECT auth.uid()))) OR ((yard_id = (SELECT private.current_yard_id())) AND ((shipping_line IS NULL) OR private.line_scope_ok(shipping_line)))));
ALTER POLICY bookings_update ON public.bookings
  USING (((SELECT private.is_super_admin((SELECT auth.uid()))) OR ((yard_id = (SELECT private.current_yard_id())) AND (((SELECT auth.uid()) = created_by) OR private.is_yard_admin((SELECT auth.uid()), yard_id)))));

ALTER POLICY cc_select ON public.cash_counts
  USING (((SELECT private.is_super_admin((SELECT auth.uid()))) OR private.is_yard_admin((SELECT auth.uid()), yard_id) OR (counted_by = (SELECT auth.uid()))));

ALTER POLICY cpd_delete ON public.container_port_data
  USING (((SELECT private.is_super_admin((SELECT auth.uid()))) OR private.is_yard_admin((SELECT auth.uid()), yard_id)));
ALTER POLICY cpd_insert ON public.container_port_data
  WITH CHECK (((SELECT private.is_super_admin((SELECT auth.uid()))) OR ((yard_id = (SELECT private.current_yard_id())) AND (private.is_yard_admin((SELECT auth.uid()), yard_id) OR ((SELECT private.is_line_rep((SELECT auth.uid()))) AND private.line_scope_ok(shipping_line))))));
ALTER POLICY cpd_select ON public.container_port_data
  USING (((SELECT private.is_super_admin((SELECT auth.uid()))) OR ((yard_id = (SELECT private.current_yard_id())) AND private.line_scope_ok(shipping_line))));
ALTER POLICY cpd_update ON public.container_port_data
  USING (((SELECT private.is_super_admin((SELECT auth.uid()))) OR ((yard_id = (SELECT private.current_yard_id())) AND (private.is_yard_admin((SELECT auth.uid()), yard_id) OR ((SELECT private.is_line_rep((SELECT auth.uid()))) AND private.line_scope_ok(shipping_line))))))
  WITH CHECK (((SELECT private.is_super_admin((SELECT auth.uid()))) OR ((yard_id = (SELECT private.current_yard_id())) AND (private.is_yard_admin((SELECT auth.uid()), yard_id) OR ((SELECT private.is_line_rep((SELECT auth.uid()))) AND private.line_scope_ok(shipping_line))))));

ALTER POLICY container_visits_delete ON public.container_visits
  USING (((SELECT private.is_super_admin((SELECT auth.uid()))) OR private.is_yard_admin((SELECT auth.uid()), yard_id)));
ALTER POLICY container_visits_insert ON public.container_visits
  WITH CHECK ((((SELECT auth.uid()) = created_by) AND (NOT (SELECT private.is_line_rep((SELECT auth.uid())))) AND ((SELECT private.is_super_admin((SELECT auth.uid()))) OR ((yard_id = (SELECT private.current_yard_id())) AND (private.is_yard_admin((SELECT auth.uid()), yard_id) OR private.has_approved_inspection_for_trip(container_id))))));
ALTER POLICY container_visits_select ON public.container_visits
  USING (((SELECT private.is_super_admin((SELECT auth.uid()))) OR ((yard_id = (SELECT private.current_yard_id())) AND ((NOT (SELECT private.is_line_rep((SELECT auth.uid())))) OR (EXISTS ( SELECT 1
   FROM containers c
  WHERE ((c.id = container_visits.container_id) AND private.line_scope_ok(c.shipping_line))))))));
ALTER POLICY container_visits_update ON public.container_visits
  USING (((SELECT private.is_super_admin((SELECT auth.uid()))) OR ((yard_id = (SELECT private.current_yard_id())) AND (NOT (SELECT private.is_line_rep((SELECT auth.uid())))))))
  WITH CHECK (((SELECT private.is_super_admin((SELECT auth.uid()))) OR ((yard_id = (SELECT private.current_yard_id())) AND (NOT (SELECT private.is_line_rep((SELECT auth.uid())))))));

ALTER POLICY containers_delete ON public.containers
  USING ((SELECT private.is_super_admin((SELECT auth.uid()))));
ALTER POLICY containers_insert ON public.containers
  WITH CHECK ((((SELECT auth.uid()) IS NOT NULL) AND (NOT (SELECT private.is_line_rep((SELECT auth.uid()))))));
ALTER POLICY containers_update ON public.containers
  USING ((((SELECT auth.uid()) IS NOT NULL) AND (NOT (SELECT private.is_line_rep((SELECT auth.uid()))))))
  WITH CHECK ((((SELECT auth.uid()) IS NOT NULL) AND (NOT (SELECT private.is_line_rep((SELECT auth.uid()))))));

ALTER POLICY dp_insert ON public.demurrage_payments
  WITH CHECK ((((SELECT auth.uid()) = collected_by) AND (NOT (SELECT private.is_line_rep((SELECT auth.uid())))) AND ((SELECT private.is_super_admin((SELECT auth.uid()))) OR (yard_id = (SELECT private.current_yard_id())))));
ALTER POLICY dp_select ON public.demurrage_payments
  USING (((SELECT private.is_super_admin((SELECT auth.uid()))) OR ((yard_id = (SELECT private.current_yard_id())) AND private.line_scope_ok(shipping_line))));

ALTER POLICY edi_delete ON public.edi_transmissions
  USING (((SELECT private.is_super_admin((SELECT auth.uid()))) OR ((yard_id = (SELECT private.current_yard_id())) AND private.is_yard_admin((SELECT auth.uid()), yard_id))));
ALTER POLICY edi_insert ON public.edi_transmissions
  WITH CHECK (((SELECT private.is_super_admin((SELECT auth.uid()))) OR ((yard_id = (SELECT private.current_yard_id())) AND private.is_yard_admin((SELECT auth.uid()), yard_id))));
ALTER POLICY edi_select ON public.edi_transmissions
  USING (((SELECT private.is_super_admin((SELECT auth.uid()))) OR ((yard_id = (SELECT private.current_yard_id())) AND private.is_yard_admin((SELECT auth.uid()), yard_id))));
ALTER POLICY edi_update ON public.edi_transmissions
  USING (((SELECT private.is_super_admin((SELECT auth.uid()))) OR ((yard_id = (SELECT private.current_yard_id())) AND private.is_yard_admin((SELECT auth.uid()), yard_id))))
  WITH CHECK (((SELECT private.is_super_admin((SELECT auth.uid()))) OR ((yard_id = (SELECT private.current_yard_id())) AND private.is_yard_admin((SELECT auth.uid()), yard_id))));

ALTER POLICY inspector_checks_insert ON public.inspector_checks
  WITH CHECK (((inspector_id = (SELECT auth.uid())) AND ((SELECT private.has_role((SELECT auth.uid()), 'inspector'::app_role)) OR (SELECT private.has_role((SELECT auth.uid()), 'admin'::app_role)) OR (SELECT private.has_role((SELECT auth.uid()), 'super_admin'::app_role)))));
ALTER POLICY inspector_checks_select ON public.inspector_checks
  USING (((SELECT private.is_super_admin((SELECT auth.uid()))) OR ((yard_id IS NOT NULL) AND (yard_id = (SELECT private.current_yard_id())) AND ((NOT (SELECT private.is_line_rep((SELECT auth.uid())))) OR (EXISTS ( SELECT 1
   FROM containers c
  WHERE ((c.container_number = inspector_checks.container_number) AND private.line_scope_ok(c.shipping_line))))))));
ALTER POLICY inspector_checks_update ON public.inspector_checks
  USING (((SELECT private.is_super_admin((SELECT auth.uid()))) OR ((yard_id = (SELECT private.current_yard_id())) AND ((SELECT private.has_role((SELECT auth.uid()), 'admin'::app_role)) OR (SELECT private.has_role((SELECT auth.uid()), 'inspector'::app_role))))));

ALTER POLICY profiles_delete_admin ON public.profiles
  USING (((SELECT private.is_super_admin((SELECT auth.uid()))) OR ((yard_id IS NOT NULL) AND private.is_yard_admin((SELECT auth.uid()), yard_id))));
ALTER POLICY profiles_insert_self ON public.profiles
  WITH CHECK (((SELECT auth.uid()) = user_id));
ALTER POLICY profiles_select ON public.profiles
  USING (((SELECT private.is_super_admin((SELECT auth.uid()))) OR (user_id = (SELECT auth.uid())) OR ((yard_id IS NOT NULL) AND (yard_id = (SELECT private.current_yard_id())) AND (NOT (SELECT private.is_line_rep((SELECT auth.uid())))))));

ALTER POLICY slt_select ON public.shipping_line_transfers
  USING (((SELECT private.is_super_admin((SELECT auth.uid()))) OR private.is_yard_admin((SELECT auth.uid()), yard_id) OR ((yard_id = (SELECT private.current_yard_id())) AND (SELECT private.is_line_rep((SELECT auth.uid()))) AND private.line_scope_ok(shipping_line))));

ALTER POLICY user_roles_delete ON public.user_roles
  USING (((SELECT private.is_super_admin((SELECT auth.uid()))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = user_roles.user_id) AND (p.yard_id IS NOT NULL) AND private.is_yard_admin((SELECT auth.uid()), p.yard_id))))));
ALTER POLICY user_roles_insert ON public.user_roles
  WITH CHECK (((SELECT private.is_super_admin((SELECT auth.uid()))) OR ((role <> 'super_admin'::app_role) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = user_roles.user_id) AND (p.yard_id IS NOT NULL) AND private.is_yard_admin((SELECT auth.uid()), p.yard_id)))))));
ALTER POLICY user_roles_select ON public.user_roles
  USING (((SELECT private.is_super_admin((SELECT auth.uid()))) OR (user_id = (SELECT auth.uid())) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = user_roles.user_id) AND (p.yard_id IS NOT NULL) AND private.is_yard_admin((SELECT auth.uid()), p.yard_id))))));
ALTER POLICY user_roles_update ON public.user_roles
  USING (((SELECT private.is_super_admin((SELECT auth.uid()))) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = user_roles.user_id) AND (p.yard_id IS NOT NULL) AND private.is_yard_admin((SELECT auth.uid()), p.yard_id))))))
  WITH CHECK (((SELECT private.is_super_admin((SELECT auth.uid()))) OR ((role <> 'super_admin'::app_role) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.user_id = user_roles.user_id) AND (p.yard_id IS NOT NULL) AND private.is_yard_admin((SELECT auth.uid()), p.yard_id)))))));

ALTER POLICY yards_delete_super ON public.yards
  USING ((SELECT private.is_super_admin((SELECT auth.uid()))));
ALTER POLICY yards_insert_super ON public.yards
  WITH CHECK (((SELECT private.is_super_admin((SELECT auth.uid()))) AND (created_by = (SELECT auth.uid()))));
ALTER POLICY yards_select ON public.yards
  USING (((SELECT private.is_super_admin((SELECT auth.uid()))) OR (id = (SELECT private.current_yard_id()))));
ALTER POLICY yards_update_super ON public.yards
  USING ((SELECT private.is_super_admin((SELECT auth.uid()))))
  WITH CHECK ((SELECT private.is_super_admin((SELECT auth.uid()))));

-- ── 2. One permissive policy per role and action ─────────────────────────────

-- profiles UPDATE: admins edit the accounts of their yard (super admins any
-- account); everyone edits their own name, but not their role, yard, username
-- or shipping line. Was profiles_update_admin + profiles_update_self.

-- True when the caller's stored yard, username and shipping line equal the
-- given ones. Reads profiles as its owner, so a profiles policy can call it
-- without Postgres expanding profiles' policies inside themselves. Like the
-- subqueries it replaces, it sees the row as it was before the update.
CREATE OR REPLACE FUNCTION private.own_profile_identity_unchanged(_yard_id uuid, _username text, _shipping_line text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles p
     WHERE p.user_id = auth.uid()
       AND p.yard_id       IS NOT DISTINCT FROM _yard_id
       AND p.username      IS NOT DISTINCT FROM _username
       AND p.shipping_line IS NOT DISTINCT FROM _shipping_line
  );
$function$;
REVOKE ALL ON FUNCTION private.own_profile_identity_unchanged(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION private.own_profile_identity_unchanged(uuid, text, text) TO authenticated, service_role;

DROP POLICY profiles_update_admin ON public.profiles;
DROP POLICY profiles_update_self ON public.profiles;
CREATE POLICY profiles_update ON public.profiles
  FOR UPDATE TO authenticated
  USING (
    -- admins (was profiles_update_admin)
    (SELECT private.is_super_admin((SELECT auth.uid())))
    OR (user_id <> (SELECT auth.uid()) AND yard_id IS NOT NULL
        AND private.is_yard_admin((SELECT auth.uid()), yard_id))
    -- the account itself (was profiles_update_self)
    OR (SELECT auth.uid()) = user_id
  )
  WITH CHECK (
    (SELECT private.is_super_admin((SELECT auth.uid())))
    OR (user_id <> (SELECT auth.uid()) AND yard_id IS NOT NULL
        AND private.is_yard_admin((SELECT auth.uid()), yard_id))
    OR ((SELECT auth.uid()) = user_id
        AND role = 'user'::public.app_role
        AND private.own_profile_identity_unchanged(yard_id, username, shipping_line))
  );

-- shipping_lines: everyone signed in reads the list; only a super admin changes
-- it. shipping_lines_modify was FOR ALL, so it also covered SELECT alongside
-- shipping_lines_select. Split into the three write commands.
DROP POLICY shipping_lines_modify ON public.shipping_lines;
CREATE POLICY shipping_lines_insert ON public.shipping_lines
  FOR INSERT TO authenticated WITH CHECK ((SELECT private.is_super_admin((SELECT auth.uid()))));
CREATE POLICY shipping_lines_update ON public.shipping_lines
  FOR UPDATE TO authenticated USING ((SELECT private.is_super_admin((SELECT auth.uid())))) WITH CHECK ((SELECT private.is_super_admin((SELECT auth.uid()))));
CREATE POLICY shipping_lines_delete ON public.shipping_lines
  FOR DELETE TO authenticated USING ((SELECT private.is_super_admin((SELECT auth.uid()))));

-- ── 3. Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS container_visits_created_by_idx   ON public.container_visits (created_by);
CREATE INDEX IF NOT EXISTS container_visits_gated_out_by_idx ON public.container_visits (gated_out_by);
CREATE INDEX IF NOT EXISTS inspector_checks_cancelled_by_idx ON public.inspector_checks (cancelled_by);
CREATE INDEX IF NOT EXISTS inspector_checks_inspector_id_idx ON public.inspector_checks (inspector_id);
CREATE INDEX IF NOT EXISTS inspector_checks_yard_id_idx      ON public.inspector_checks (yard_id);

-- Same columns as the unique constraint container_port_data_container_number_yard_id_key,
-- whose index stays and serves the same lookups.
DROP INDEX IF EXISTS public.container_port_data_container_yard_idx;
