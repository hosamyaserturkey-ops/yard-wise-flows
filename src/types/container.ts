import type { ShippingLine } from "@/lib/shippingLines";

/**
 * UI-facing container view. Backed by a `container_visits` row joined to its
 * master `containers` row. `id` is the visit id — use it for gate-out /
 * reserve / unreserve updates. `containerId` is the master container id.
 */
export interface Container {
  id: string;
  containerId?: string;
  /** Sequential reception/gate-out ticket number for this visit (shared by both tickets). */
  ticketNumber: number;
  containerNumber: string;
  containerType: string;
  shippingLine: ShippingLine;
  driverName: string;
  truckNumber: string;
  gateInTime: Date;
  gateOutTime?: Date;
  status: "in-yard" | "out" | "reserved";
  bookingNumber?: string;
  bookingId?: string;
  fees?: number;
  yardBlock?: string;
  yardRow?: string;
}

export interface GateInData {
  containerNumber: string;
  containerType: string;
  shippingLine: ShippingLine;
  driverName: string;
  truckNumber: string;
  portArrivalDate: string;
  freeDays: string;
  dailyDemurrage: string;
  yardBlock: string;
  yardRow: string;
}

export interface GateOutData {
  containerId: string;
  bookingNumber: string;
  fees: number;
}

export interface Receipt {
  id: string;
  type: "gate-in" | "gate-out";
  containerNumber: string;
  driverName: string;
  truckNumber: string;
  timestamp: Date;
  shippingLine: string;
  bookingNumber?: string;
  fees?: number;
}
