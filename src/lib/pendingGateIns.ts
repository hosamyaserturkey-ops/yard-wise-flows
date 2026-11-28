import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import type { PendingGateIn } from "@/types/gateIn";

export interface CheckRow {
  id: string;
  container_number: string;
  container_type: string | null;
  grade: string;
  status: string;
  notes: string | null;
  created_at: string;
}

interface VisitRow {
  gate_out_time: string | null;
  containers: { container_number: string } | null;
}

/** Keeps the URL of each `.in()` request well short of proxy limits. */
const NUMBERS_PER_REQUEST = 100;

/**
 * Latest check per container, kept only when it's an approval for a box that
 * isn't in the yard. `checks` must be newest first.
 */
export function approvedNotInYard(checks: CheckRow[], inYard: Set<string>): CheckRow[] {
  const latest = new Map<string, CheckRow>();
  for (const c of checks) {
    if (!latest.has(c.container_number)) latest.set(c.container_number, c);
  }
  return Array.from(latest.values()).filter(
    (c) => c.status === "approved" && !inYard.has(c.container_number),
  );
}

/**
 * Drops approvals already spent on a completed trip: an approval only counts
 * if it's newer than the container's last gate-out (matches the gate-in form
 * and the has_approved_inspection_for_trip DB rule).
 */
export function unspentApprovals(candidates: CheckRow[], lastGateOut: Map<string, string>): PendingGateIn[] {
  return candidates
    .filter((c) => {
      const out = lastGateOut.get(c.container_number);
      return !out || new Date(c.created_at).getTime() > new Date(out).getTime();
    })
    .map((c) => ({
      id: c.id,
      container_number: c.container_number,
      container_type: c.container_type,
      grade: c.grade,
      notes: c.notes,
      inspected_at: c.created_at,
    }));
}

/** Container number from a visit row joined to containers. */
const numberOf = (r: VisitRow) => r.containers?.container_number ?? "";

/**
 * Approved inspections at this yard that haven't been gated in yet.
 *
 * Every query pages through all its rows. A single select stops at 1,000 rows,
 * and once a yard's visit history passed that the newest gate-ins were the ones
 * cut off, so boxes already in the yard stayed in the queue.
 */
export async function fetchPendingGateIns(yardId: string): Promise<PendingGateIn[]> {
  const [checks, openVisits] = await Promise.all([
    // Cancelled checks are excluded in the query, not filtered afterwards: the
    // "latest per container" pass would otherwise let a cancelled row shadow
    // an older, still-valid approval for the same number.
    fetchAllRows<CheckRow>((from, to) =>
      supabase
        .from("inspector_checks")
        .select("id, container_number, container_type, grade, status, notes, created_at")
        .eq("yard_id", yardId)
        .neq("status", "cancelled")
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    ),
    // Open visits are the boxes in the yard right now.
    fetchAllRows<VisitRow>((from, to) =>
      supabase
        .from("container_visits")
        .select("gate_out_time, containers!inner(container_number)")
        .eq("yard_id", yardId)
        .is("gate_out_time", null)
        .order("id")
        .range(from, to),
    ),
  ]);

  const inYard = new Set(openVisits.map(numberOf).filter(Boolean));
  const candidates = approvedNotInYard(checks, inYard);
  if (candidates.length === 0) return [];

  // Gate-outs are only needed for the few boxes still in the running, not the
  // yard's whole history.
  const numbers = candidates.map((c) => c.container_number);
  const batches: string[][] = [];
  for (let i = 0; i < numbers.length; i += NUMBERS_PER_REQUEST) {
    batches.push(numbers.slice(i, i + NUMBERS_PER_REQUEST));
  }
  const closedVisits = (
    await Promise.all(
      batches.map((batch) =>
        fetchAllRows<VisitRow>((from, to) =>
          supabase
            .from("container_visits")
            .select("gate_out_time, containers!inner(container_number)")
            .eq("yard_id", yardId)
            .not("gate_out_time", "is", null)
            .in("containers.container_number", batch)
            .order("id")
            .range(from, to),
        ),
      ),
    )
  ).flat();

  const lastGateOut = new Map<string, string>();
  for (const r of closedVisits) {
    const num = numberOf(r);
    if (!num || !r.gate_out_time) continue;
    const prev = lastGateOut.get(num);
    if (!prev || new Date(r.gate_out_time).getTime() > new Date(prev).getTime()) {
      lastGateOut.set(num, r.gate_out_time);
    }
  }

  return unspentApprovals(candidates, lastGateOut);
}
