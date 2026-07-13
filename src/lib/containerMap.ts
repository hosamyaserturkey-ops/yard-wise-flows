import type { Container } from "@/types/container";
import type { ShippingLine } from "@/lib/shippingLines";

/**
 * Shape returned by
 *   supabase.from("container_visits").select("*, containers!inner(...)")
 */
export interface VisitJoinRow {
  id: string;
  container_id: string;
  yard_id: string;
  gate_in_time: string;
  gate_out_time: string | null;
  status: string;
  driver_name: string | null;
  truck_number: string | null;
  booking_id: string | null;
  booking_number: string | null;
  fees: number | string | null;
  port_arrival_date: string | null;
  free_days: number;
  daily_demurrage: number | string | null;
  yard_block: string | null;
  yard_row: string | null;
  containers: {
    id?: string;
    container_number: string;
    container_type: string;
    shipping_line: string;
  } | null;
}

export const VISIT_WITH_CONTAINER =
  "*, containers!inner(id, container_number, container_type, shipping_line)";

export function mapVisit(v: VisitJoinRow): Container {
  const master = v.containers ?? {
    container_number: "",
    container_type: "",
    shipping_line: "",
    id: v.container_id,
  };
  return {
    id: v.id,
    containerId: master.id ?? v.container_id,
    containerNumber: master.container_number,
    containerType: master.container_type,
    shippingLine: master.shipping_line as ShippingLine,
    driverName: v.driver_name ?? "",
    truckNumber: v.truck_number ?? "",
    gateInTime: new Date(v.gate_in_time),
    gateOutTime: v.gate_out_time ? new Date(v.gate_out_time) : undefined,
    status: v.status as "in-yard" | "out" | "reserved",
    bookingNumber: v.booking_number ?? undefined,
    bookingId: v.booking_id ?? undefined,
    fees: v.fees != null ? Number(v.fees) : undefined,
    yardBlock: v.yard_block ?? undefined,
    yardRow: v.yard_row ?? undefined,
  };
}
