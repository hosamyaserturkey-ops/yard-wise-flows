// Shared types for the gate-in flow (page, hooks, receipt printing).

export interface PendingGateIn {
  container_number: string;
  grade: string;
  notes: string | null;
  inspected_at: string;
}

export interface InspectionStatus {
  status: "approved" | "rejected" | "pending";
  grade: string;
}

export interface InsertedContainerRow {
  id: string;
  container_number: string;
  container_type: string;
  shipping_line: string;
  driver_name: string;
  truck_number: string;
  gate_in_time: string;
}

export interface DemurragePaymentData {
  id: string;
  chargeableDays: number;
  demurrageAmount: number;
  serviceFee: number;
  totalCollected: number;
  paymentMethod: string;
}

// Auto-filled values from the container_port_data lookup.
export interface PortLookupData {
  port_arrival_date: string;
  free_days: number;
  daily_demurrage: number;
  shipping_line: string;
}
