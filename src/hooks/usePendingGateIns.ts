import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { fetchPendingGateIns } from "@/lib/pendingGateIns";
import type { PendingGateIn } from "@/types/gateIn";

/**
 * Approved inspections that haven't been gated in yet, kept live via
 * realtime subscriptions on inspector_checks and container_visits.
 */
export function usePendingGateIns(currentYardId: () => string | null) {
  const [pendingGateIns, setPendingGateIns] = useState<PendingGateIn[]>([]);
  // A gate-in fires several realtime events in a row; only the newest reload
  // may write, so a slower earlier one can't put a gated-in box back.
  const latestRequest = useRef(0);

  const reload = useCallback(async () => {
    const yardId = currentYardId();
    if (!yardId) return;
    const request = ++latestRequest.current;
    try {
      const items = await fetchPendingGateIns(yardId);
      if (request === latestRequest.current) setPendingGateIns(items);
    } catch (err) {
      // Keep the last good list rather than blanking the queue on a blip.
      console.error("Failed to load the Awaiting Gate-In queue", err);
    }
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
