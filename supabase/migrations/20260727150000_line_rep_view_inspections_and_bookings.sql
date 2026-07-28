-- Line reps get read-only visibility into two things that were previously
-- hidden from them entirely:
--   1. Inspection grade/photos for containers on their own shipping line.
--   2. Bookings in their yard (bookings have no shipping-line column, so this
--      is yard-wide, matching what every other non-admin role sees).
-- No write access is granted anywhere in this migration — line reps remain
-- read-only across the app.

-- inspector_checks: widen SELECT so a line rep can read inspection rows for
-- containers on their own line, mirroring the container_visits_select pattern
-- from 20260719210100_line_rep_scoping.sql.
ALTER POLICY inspector_checks_select ON public.inspector_checks
  USING (
    is_super_admin(auth.uid())
    OR (
      yard_id IS NOT NULL
      AND yard_id = current_yard_id()
      AND (
        NOT is_line_rep(auth.uid())
        OR EXISTS (
          SELECT 1 FROM public.containers c
          WHERE c.container_number = inspector_checks.container_number
            AND c.shipping_line = rep_shipping_line(auth.uid())
        )
      )
    )
  );

-- inspection-photos storage bucket: let line reps view legacy (pre-R2)
-- inspection photos, matching the inspector_checks grant above.
DROP POLICY IF EXISTS "inspection_photos_select" ON storage.objects;
CREATE POLICY "inspection_photos_select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'inspection-photos'
  AND (
    public.is_super_admin(auth.uid())
    OR public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'inspector'::public.app_role)
    OR public.has_role(auth.uid(), 'line_rep'::public.app_role)
  )
);

-- bookings: line reps can now see every booking in their yard (read-only —
-- bookings_insert/update/delete are untouched and still exclude/ignore them).
ALTER POLICY bookings_select ON public.bookings
  USING (
    is_super_admin(auth.uid())
    OR yard_id = current_yard_id()
  );
