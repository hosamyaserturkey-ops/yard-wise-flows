-- Cancelling (voiding) a mistaken inspection.
--
-- An inspection recorded against a mistyped container number is unreachable
-- today: no truck will ever arrive for that number, so nothing can consume
-- the approval, and it sits in the gate-in "Awaiting Gate-In" queue forever.
-- inspector_checks has no DELETE policy and no UI writes `status`, so the row
-- cannot be removed at all.
--
-- The fix is a soft cancel: the row keeps its photos and audit trail, but the
-- queue, the gate-in badge and has_approved_inspection_for_trip all key off
-- status = 'approved', so a cancelled row stops counting everywhere at once.

-- 1. Allow the new status value.
ALTER TABLE public.inspector_checks
  DROP CONSTRAINT IF EXISTS inspector_checks_status_check;
ALTER TABLE public.inspector_checks
  ADD CONSTRAINT inspector_checks_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled'));

-- 2. Who cancelled it, when, and why.
ALTER TABLE public.inspector_checks
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text;

-- 3. Restrict which columns a non-admin may change, and stamp the cancel
--    attribution server-side.
--
--    RLS WITH CHECK cannot see the OLD row, so a column-level rule has to live
--    in a trigger. This also closes an existing hole: inspector_checks_update
--    (20260728120000_any_inspector_can_add_photos.sql) has a USING clause and
--    no WITH CHECK, so any yard inspector could rewrite the grade or status of
--    any check. That policy stays as it is — inspectors still need it to append
--    photo_urls from the Photo Archive — and this trigger narrows it to the
--    columns they legitimately touch.
--
--    The rename_container RPC added in the next migration changes
--    container_number here. It is SECURITY DEFINER, but auth.uid() still
--    resolves to the real caller, who is an admin, so the admin branch below
--    covers it with no special case.
CREATE OR REPLACE FUNCTION public.inspector_checks_guard_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  is_admin boolean;
BEGIN
  IF (NEW.status           IS DISTINCT FROM OLD.status)
  OR (NEW.grade            IS DISTINCT FROM OLD.grade)
  OR (NEW.container_number IS DISTINCT FROM OLD.container_number)
  OR (NEW.container_type   IS DISTINCT FROM OLD.container_type)
  OR (NEW.yard_id          IS DISTINCT FROM OLD.yard_id)
  OR (NEW.inspector_id     IS DISTINCT FROM OLD.inspector_id)
  THEN
    is_admin := public.is_super_admin(auth.uid())
             OR public.is_yard_admin(auth.uid(), OLD.yard_id);
    IF NOT is_admin THEN
      RAISE EXCEPTION
        'Only a yard admin can change an inspection''s status, grade, container number or type.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  -- Attribution is stamped here rather than trusted from the client.
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    NEW.cancelled_by := auth.uid();
    NEW.cancelled_at := now();
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS inspector_checks_guard_fields ON public.inspector_checks;
CREATE TRIGGER inspector_checks_guard_fields
  BEFORE UPDATE ON public.inspector_checks
  FOR EACH ROW EXECUTE FUNCTION public.inspector_checks_guard_fields();

-- 4. has_approved_inspection_for_trip needs no change: it already requires
--    status = 'approved', and it is an EXISTS, so cancelling one of two
--    duplicate approvals correctly leaves the other one valid.
