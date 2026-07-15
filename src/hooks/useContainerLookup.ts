import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { InspectionStatus, PortLookupData } from "@/types/gateIn";

/**
 * Debounced lookup of everything gate-in needs to know about a container
 * number: port data (auto-fill), open-visit status, earliest gate-in date,
 * prior demurrage payment, and latest inspection.
 *
 * `onPortData` is called with the port row when found, or null when not, so
 * the form can auto-fill / clear its port fields.
 */
export function useContainerLookup(
  containerNumber: string,
  currentYardId: () => string | null,
  onPortData: (data: PortLookupData | null) => void,
) {
  const [portDataFound, setPortDataFound] = useState(false);
  const [lookupDone, setLookupDone] = useState(false);
  // Most recent demurrage payment for this container, if any. The page decides
  // whether it settles the CURRENT trip by comparing it to the port arrival date.
  const [lastDemurragePaymentAt, setLastDemurragePaymentAt] = useState<Date | null>(null);
  const [alreadyInYard, setAlreadyInYard] = useState(false);
  // All gate-in times for this container, ascending. The page picks the first
  // one belonging to the current trip — demurrage stops accruing at that date.
  const [gateInTimes, setGateInTimes] = useState<Date[]>([]);
  const [inspectionStatus, setInspectionStatus] = useState<InspectionStatus | null>(null);

  // Keep callbacks in refs so the effect only re-runs on containerNumber changes.
  const onPortDataRef = useRef(onPortData);
  onPortDataRef.current = onPortData;
  const currentYardIdRef = useRef(currentYardId);
  currentYardIdRef.current = currentYardId;

  const reset = () => {
    setPortDataFound(false);
    setLookupDone(false);
    setLastDemurragePaymentAt(null);
    setAlreadyInYard(false);
    setInspectionStatus(null);
    setGateInTimes([]);
  };

  useEffect(() => {
    const containerNum = containerNumber.trim().toUpperCase();
    if (containerNum.length < 4) {
      reset();
      return;
    }

    const timer = setTimeout(async () => {
      // Port data lookup — scoped to the current yard so each yard sees its own row.
      const yardId = currentYardIdRef.current();
      let query = supabase
        .from("container_port_data")
        .select("port_arrival_date, free_days, daily_demurrage, shipping_line")
        .eq("container_number", containerNum);
      if (yardId) query = query.eq("yard_id", yardId);
      const { data } = await query
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      onPortDataRef.current(data ?? null);
      setPortDataFound(!!data);

      // Already-in-yard check: is there an open visit for this container?
      const { data: masterRow } = await supabase
        .from("containers")
        .select("id")
        .eq("container_number", containerNum)
        .maybeSingle();

      let openVisit: { id: string } | null = null;
      let visitTimes: { gate_in_time: string }[] = [];
      if (masterRow?.id) {
        const { data: openRow } = await supabase
          .from("container_visits")
          .select("id")
          .eq("container_id", masterRow.id)
          .is("gate_out_time", null)
          .maybeSingle();
        openVisit = openRow ?? null;

        const { data: visitRows } = await supabase
          .from("container_visits")
          .select("gate_in_time")
          .eq("container_id", masterRow.id)
          .order("gate_in_time", { ascending: true });
        visitTimes = visitRows ?? [];
      }
      setAlreadyInYard(!!openVisit);
      setGateInTimes(
        visitTimes
          .filter((v) => v.gate_in_time)
          .map((v) => new Date(v.gate_in_time)),
      );

      // Latest demurrage payment. Whether it settles the current trip is
      // decided against the port arrival date — a payment from a previous
      // trip must not settle a new one.
      const { data: paymentRow } = await supabase
        .from("demurrage_payments")
        .select("created_at")
        .eq("container_number", containerNum)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setLastDemurragePaymentAt(
        paymentRow?.created_at ? new Date(paymentRow.created_at) : null,
      );

      // Latest inspection check for this container
      const { data: inspectionRow } = await supabase
        .from("inspector_checks")
        .select("status, grade")
        .eq("container_number", containerNum)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      setInspectionStatus(
        inspectionRow
          ? { status: inspectionRow.status as InspectionStatus["status"], grade: inspectionRow.grade }
          : null,
      );

      setLookupDone(true);
    }, 500);

    return () => clearTimeout(timer);
  }, [containerNumber]);

  return {
    portDataFound,
    lookupDone,
    lastDemurragePaymentAt,
    setLastDemurragePaymentAt,
    alreadyInYard,
    setAlreadyInYard,
    gateInTimes,
    inspectionStatus,
    reset,
  };
}
