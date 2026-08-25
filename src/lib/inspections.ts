import { supabase } from "@/integrations/supabase/client";
import { logActivity } from "@/lib/activityLog";

export interface CancelInspectionInput {
  checkId: string;
  /** Why it was voided — required, shown in the activity log. */
  reason: string;
  userId: string;
  yardId: string;
  containerNumber: string;
}

/**
 * Void a mistaken inspection.
 *
 * The row is kept (photos and audit trail survive) and only its status moves to
 * 'cancelled'. Everything that gates on an inspection — the Awaiting Gate-In
 * queue, the gate-in badge, and the has_approved_inspection_for_trip DB rule —
 * keys off status = 'approved', so this removes it from all three at once.
 *
 * Admin-only; the inspector_checks_guard_fields trigger rejects the update for
 * anyone else and stamps cancelled_by/cancelled_at server-side.
 */
export async function cancelInspection({
  checkId,
  reason,
  userId,
  yardId,
  containerNumber,
}: CancelInspectionInput): Promise<{ ok: boolean; error?: string }> {
  // Guarded on the current status and verified with .select(), so a check that
  // someone else already cancelled reports a conflict rather than silently
  // "succeeding" with zero rows touched.
  const { data, error } = await supabase
    .from("inspector_checks")
    .update({ status: "cancelled", cancel_reason: reason.trim() })
    .eq("id", checkId)
    .eq("status", "approved")
    .select("id");

  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: "This inspection is no longer approved — it may already have been cancelled." };
  }

  await logActivity({
    userId,
    yardId,
    action: "inspection_cancelled",
    containerNumber,
    metadata: { check_id: checkId, reason: reason.trim() },
  });

  return { ok: true };
}
