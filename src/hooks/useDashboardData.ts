import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Container as ContainerType } from "@/types/container";
import { calculateDemurrage, hasDemurrageRules } from "@/lib/demurrage";
import { mapVisit, VISIT_WITH_CONTAINER, type VisitJoinRow } from "@/lib/containerMap";
import type { DemurrageInfo } from "@/components/dashboard/KanbanColumn";

/**
 * Dashboard data: container visits (kept live via realtime subscription)
 * plus a batch-loaded demurrage paid/owed map keyed by container number.
 */
export function useDashboardData(currentYardId: () => string | null) {
  const [containers, setContainers] = useState<ContainerType[]>([]);
  const [demurrageMap, setDemurrageMap] = useState<Record<string, DemurrageInfo>>({});
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  const fetchContainers = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from("container_visits")
        .select(VISIT_WITH_CONTAINER)
        .order("gate_in_time", { ascending: false });

      if (error) throw error;

      const formatted: ContainerType[] = (data ?? []).map((row) =>
        mapVisit(row as unknown as VisitJoinRow),
      );

      setContainers(formatted);
      setLastUpdated(new Date());
    } catch (err) {
      console.error("Error fetching containers:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchContainers();
  }, [fetchContainers]);

  // Batch-load demurrage info
  useEffect(() => {
    if (containers.length === 0) {
      setDemurrageMap({});
      return;
    }

    const numbers = containers.map((c) => c.containerNumber);

    (async () => {
      const yardId = currentYardId();
      let portQuery = supabase
        .from("container_port_data")
        .select("container_number, port_arrival_date, shipping_line, yard_id")
        .in("container_number", numbers);
      if (yardId) portQuery = portQuery.eq("yard_id", yardId);

      const [portRes, payRes] = await Promise.all([
        portQuery,
        supabase
          .from("demurrage_payments")
          .select("container_number, total_collected")
          .in("container_number", numbers),
      ]);

      const portByNum = new Map(
        (portRes.data ?? []).map((r) => [r.container_number, r]),
      );
      const paidByNum = new Map<string, number>();
      (payRes.data ?? []).forEach((p) =>
        paidByNum.set(
          p.container_number,
          (paidByNum.get(p.container_number) ?? 0) + Number(p.total_collected ?? 0),
        ),
      );

      const map: Record<string, DemurrageInfo> = {};
      for (const c of containers) {
        const paid = paidByNum.get(c.containerNumber);
        const port = portByNum.get(c.containerNumber);

        let owed: number | undefined;
        if (port?.port_arrival_date && hasDemurrageRules(c.shippingLine)) {
          const r = calculateDemurrage(
            c.shippingLine,
            c.containerType,
            port.port_arrival_date,
            c.gateInTime,
          );
          owed = r.totalJOD;
        }

        if (paid != null || owed != null) {
          map[c.containerNumber] = { paidJOD: paid, owedJOD: owed };
        }
      }
      setDemurrageMap(map);
    })();
  }, [containers, currentYardId]);

  // Real-time subscription
  useEffect(() => {
    const channel = supabase
      .channel("dashboard_containers")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "container_visits" },
        () => fetchContainers(),
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchContainers]);

  return { containers, demurrageMap, loading, lastUpdated, fetchContainers };
}
