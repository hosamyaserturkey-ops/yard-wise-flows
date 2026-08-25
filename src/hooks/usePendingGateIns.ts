import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { PendingGateIn } from "@/types/gateIn";

/**
 * Approved inspections that haven't been gated in yet, kept live via
 * realtime subscriptions on inspector_checks and container_visits.
 */
export function usePendingGateIns(currentYardId: () => string | null) {
  const [pendingGateIns, setPendingGateIns] = useState<PendingGateIn[]>([]);

  const reload = useCallback(async () => {
    const yardId = currentYardId();
    if (!yardId) return;

    // Latest inspection per container
    // Cancelled checks are excluded in the query, not filtered afterwards: the
    // "latest per container" pass below would otherwise let a cancelled row
    // shadow an older, still-valid approval for the same number.
    const { data: checks } = await supabase
      .from("inspector_checks")
      .select("id, container_number, container_type, grade, status, notes, created_at")
      .eq("yard_id", yardId)
      .neq("status", "cancelled")
      .order("created_at", { ascending: false });

    // All visits for this yard: open visits mark containers currently in yard
    // (exclude from queue); the latest gate-out per container tells us whether
    // an approval was already spent on a completed trip (also exclude).
    const { data: visitRows } = await supabase
      .from("container_visits")
      .select("gate_out_time, containers!inner(container_number)")
      .eq("yard_id", yardId);

    const inYardSet = new Set<string>();
    const lastGateOut = new Map<string, string>();
    for (const r of (visitRows ?? []) as {
      gate_out_time: string | null;
      containers: { container_number: string } | null;
    }[]) {
      const num = r.containers?.container_number ?? "";
      if (!num) continue;
      if (!r.gate_out_time) {
        inYardSet.add(num);
      } else if (!lastGateOut.has(num) || r.gate_out_time > (lastGateOut.get(num) as string)) {
        lastGateOut.set(num, r.gate_out_time);
      }
    }

    // Keep latest check per container, then filter approved + not in yard +
    // approval newer than the container's last gate-out (a fresh, unspent
    // approval for the current trip — matches the gate-in form and DB rule).
    const latestPerContainer = new Map<string, NonNullable<typeof checks>[number]>();
    for (const c of checks || []) {
      if (!latestPerContainer.has(c.container_number)) {
        latestPerContainer.set(c.container_number, c);
      }
    }

    setPendingGateIns(
      Array.from(latestPerContainer.values())
        .filter((c) => {
          if (c.status !== "approved") return false;
          if (inYardSet.has(c.container_number)) return false;
          const out = lastGateOut.get(c.container_number);
          if (out && new Date(c.created_at).getTime() <= new Date(out).getTime()) return false;
          return true;
        })
        .map((c) => ({
          id: c.id,
          container_number: c.container_number,
          container_type: c.container_type,
          grade: c.grade,
          notes: c.notes,
          inspected_at: c.created_at,
        }))
    );
  }, [currentYardId]);

  useEffect(() => {
    reload();
    const channel = supabase
      .channel("inspector_checks_pending")
      .on("postgres_changes", { event: "*", schema: "public", table: "inspector_checks" }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "container_visits" }, reload)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [reload]);

  return { pendingGateIns, reload };
}
