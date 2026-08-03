// Who actually handled a container at the gate.
//
// A gate ticket names an operator: the person who received the container
// (gate-in) or released it (gate-out). That name must come from the visit
// record, never from the signed-in user — otherwise a reprint credits whoever
// pressed print instead of the operator who was at the gate.

import { supabase } from "@/integrations/supabase/client";

export interface VisitOperators {
  /** Operator who gated the container in. */
  receivedBy: string | null;
  /** Operator who gated the container out; null while the visit is still open. */
  releasedBy: string | null;
}

const EMPTY: VisitOperators = { receivedBy: null, releasedBy: null };

/** Prefer the full name; fall back to the login name. */
const displayName = (p: { full_name: string | null; username: string | null }): string | null =>
  p.full_name?.trim() || p.username?.trim() || null;

/**
 * Resolves the gate-in / gate-out operators for one visit.
 *
 * Best-effort: returns nulls when the rows are unreadable (line reps cannot
 * read the yard roster) so the caller can fall back rather than fail the print.
 */
export async function fetchVisitOperators(visitId: string): Promise<VisitOperators> {
  // "*" rather than naming the columns: if the frontend ships before the
  // gated_out_by migration lands, a named select rejects the whole query and
  // the gate-in operator would be lost too. With "*" the column is simply
  // absent and gate-in attribution keeps working.
  const { data: visit, error } = await supabase
    .from("container_visits")
    .select("*")
    .eq("id", visitId)
    .maybeSingle();

  if (error || !visit) return EMPTY;

  const ids = [visit.created_by, visit.gated_out_by].filter(
    (id): id is string => typeof id === "string" && id.length > 0,
  );
  if (ids.length === 0) return EMPTY;

  const { data: profiles } = await supabase
    .from("profiles")
    .select("user_id, full_name, username")
    .in("user_id", ids);

  const byId = new Map((profiles ?? []).map((p) => [p.user_id, displayName(p)]));

  return {
    receivedBy: (visit.created_by && byId.get(visit.created_by)) || null,
    releasedBy: (visit.gated_out_by && byId.get(visit.gated_out_by)) || null,
  };
}
