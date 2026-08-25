import { supabase } from "@/integrations/supabase/client";

/**
 * Correct a container number after gate-in.
 *
 * All of the work happens in the rename_container RPC, which runs as one
 * transaction: it checks that the caller is a yard admin and the container is
 * still in the yard, refuses when the target number already exists, then
 * cascades the new number across every table that stores it (inspections, port
 * data, demurrage, EDI, activity log) and writes its own audit row.
 *
 * Every failure path raises with a message written for the operator, so the
 * caller can surface `error` in a toast verbatim.
 */
export async function renameContainer(
  containerId: string,
  newNumber: string,
  reason: string,
): Promise<{ ok: boolean; oldNumber?: string; newNumber?: string; error?: string }> {
  const { data, error } = await supabase.rpc("rename_container", {
    _container_id: containerId,
    _new_number: newNumber.trim().toUpperCase(),
    _reason: reason.trim() || null,
  });

  if (error) return { ok: false, error: error.message };

  const row = Array.isArray(data) ? data[0] : data;
  return { ok: true, oldNumber: row?.old_number, newNumber: row?.new_number };
}
