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
  const [demurrageAlreadyPaid, setDemurrageAlreadyPaid] = useState(false);
  const [alreadyInYard, setAlreadyInYard] = useState(false);
  // Earliest known gate-in date for this container — demurrage stops at this date.
  const [earliestGateIn, setEarliestGateIn] = useState<Date | null>(null);
  const [inspectionStatus, setInspectionStatus] = useState<InspectionStatus | null>(null);

  // Keep callbacks in refs so the effect only re-runs on containerNumber changes.
  const onPortDataRef = useRef(onPortData);
  onPortDataRef.current = onPortData;
  const currentYardIdRef = useRef(currentYardId);
  currentYardIdRef.current = currentYardId;

  const reset = () => {
    setPortDataFound(false);
    setLookupDone(false);
    setDemurrageAlreadyPaid(false);
    setAlreadyInYard(false);
    setInspectionStatus(null);
    setEarliestGateIn(null);
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
      let firstGateIn: { gate_in_time: string } | null = null;
      if (masterRow?.id) {
        const { data: openRow } = await supabase
          .from("container_visits")
          .select("id")
          .eq("container_id", masterRow.id)
          .is("gate_out_time", null)
          .maybeSingle();
        openVisit = openRow ?? null;

        const { data: firstRow } = await supabase
          .from("container_visits")
          .select("gate_in_time")
          .eq("container_id", masterRow.id)
          .order("gate_in_time", { ascending: true })
          .limit(1)
          .maybeSingle();
        firstGateIn = firstRow ?? null;
      }
      setAlreadyInYard(!!openVisit);
      setEarliestGateIn(
        firstGateIn?.gate_in_time ? new Date(firstGateIn.gate_in_time) : null,
      );

      // Demurrage already paid: port demurrage is a one-time settlement.
      // Any existing payment for this container means it's already settled.
      const { data: paymentRow } = await supabase
        .from("demurrage_payments")
        .select("id")
        .eq("container_number", containerNum)
        .limit(1)
        .maybeSingle();
      setDemurrageAlreadyPaid(!!paymentRow);

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
    demurrageAlreadyPaid,
    setDemurrageAlreadyPaid,
    alreadyInYard,
    setAlreadyInYard,
    earliestGateIn,
    inspectionStatus,
    reset,
  };
}
