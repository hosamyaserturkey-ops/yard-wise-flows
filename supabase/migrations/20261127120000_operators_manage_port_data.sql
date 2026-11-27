-- Gate operators (role 'user') can now add and update their own yard's port
-- data: the Port Data page's Excel import and manual entry. Until now only a
-- yard admin, a super admin or a line rep (for their own line) could write it,
-- and operators could only read it.
--
-- Unchanged:
--   * cpd_select: operators already read their own yard's port data.
--   * cpd_delete: deleting port data stays with yard admins and super admins.
--   * The yard scope: an operator writes only rows whose yard_id is their
--     profile's yard. An account with no yard (a public sign-up) gets nothing,
--     because current_yard_id() is NULL.
--   * container_port_data_block_vehicle_side still keeps car-lot accounts out.
--   * Inspectors and read-only admins still cannot write port data.
--
-- line_scope_ok() is true for anyone who isn't a line rep, so it changes
-- nothing for a plain operator. It keeps an account that somehow holds both
-- 'user' and 'line_rep' confined to the rep's own line.
--
-- Same shape as 20261011130000: auth.uid() and the constant role checks are
-- wrapped in SELECT so they are evaluated once per query, not once per row.

ALTER POLICY cpd_insert ON public.container_port_data
  WITH CHECK (
    (SELECT private.is_super_admin((SELECT auth.uid())))
    OR (
      yard_id = (SELECT private.current_yard_id())
      AND (
        private.is_yard_admin((SELECT auth.uid()), yard_id)
        OR ((SELECT private.is_line_rep((SELECT auth.uid()))) AND private.line_scope_ok(shipping_line))
        OR ((SELECT private.has_role((SELECT auth.uid()), 'user'::public.app_role)) AND private.line_scope_ok(shipping_line))
      )
    )
  );

ALTER POLICY cpd_update ON public.container_port_data
  USING (
    (SELECT private.is_super_admin((SELECT auth.uid())))
    OR (
      yard_id = (SELECT private.current_yard_id())
      AND (
        private.is_yard_admin((SELECT auth.uid()), yard_id)
        OR ((SELECT private.is_line_rep((SELECT auth.uid()))) AND private.line_scope_ok(shipping_line))
        OR ((SELECT private.has_role((SELECT auth.uid()), 'user'::public.app_role)) AND private.line_scope_ok(shipping_line))
      )
    )
  )
  WITH CHECK (
    (SELECT private.is_super_admin((SELECT auth.uid())))
    OR (
      yard_id = (SELECT private.current_yard_id())
      AND (
        private.is_yard_admin((SELECT auth.uid()), yard_id)
        OR ((SELECT private.is_line_rep((SELECT auth.uid()))) AND private.line_scope_ok(shipping_line))
        OR ((SELECT private.has_role((SELECT auth.uid()), 'user'::public.app_role)) AND private.line_scope_ok(shipping_line))
      )
    )
  );
