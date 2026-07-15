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
    const { data: checks } = await supabase
      .from("inspector_checks")
      .select("container_number, grade, status, notes, created_at")
      .eq("yard_id", yardId)
      .order("created_at", { ascending: false });

    // Containers currently in yard (open visits) — used to exclude from queue.
    const { data: inYardRows } = await supabase
      .from("container_visits")
      .select("containers!inner(container_number)")
      .eq("yard_id", yardId)
      .is("gate_out_time", null);

    const inYardSet = new Set(
      (inYardRows ?? []).map((r: { containers: { container_number: string } | null }) =>
        r.containers?.container_number ?? ""
      )
    );

    // Keep latest check per container, then filter approved + not in yard
    const latestPerContainer = new Map<string, NonNullable<typeof checks>[number]>();
    for (const c of checks || []) {
      if (!latestPerContainer.has(c.container_number)) {
        latestPerContainer.set(c.container_number, c);
      }
    }

    setPendingGateIns(
      Array.from(latestPerContainer.values())
        .filter((c) => c.status === "approved" && !inYardSet.has(c.container_number))
        .map((c) => ({
          container_number: c.container_number,
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
