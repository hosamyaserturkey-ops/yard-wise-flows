import { supabase } from "@/integrations/supabase/client";
import { shiftForDate } from "@/lib/shifts";

export type ActivityAction =
  | "gate_in"
  | "gate_out"
  | "reserve"
  | "unreserve"
  | "demurrage_collected";

export interface LogActivityInput {
  userId: string;
  yardId: string;
  action: ActivityAction;
  containerId?: string | null;
  containerNumber?: string | null;
  metadata?: Record<string, unknown>;
  occurredAt?: Date;
}

/**
 * Insert a row into activity_log. Best-effort — logs errors but never throws,
 * so a logging failure doesn't roll back the underlying gate action.
 */
export async function logActivity(input: LogActivityInput): Promise<void> {
  const occurred = input.occurredAt ?? new Date();
  try {
    const { error } = await supabase.from("activity_log").insert({
      user_id: input.userId,
      yard_id: input.yardId,
      action: input.action,
      container_id: input.containerId ?? null,
      container_number: input.containerNumber ?? null,
      shift: shiftForDate(occurred),
      occurred_at: occurred.toISOString(),
      metadata: (input.metadata ?? {}) as never,
    });
    if (error) console.error("activity_log insert failed:", error);
  } catch (err) {
    console.error("activity_log insert threw:", err);
  }
}
