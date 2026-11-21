/** Turning rows of public.vehicle_events into lines a person can read. */

export type CarEventAction = "gate_in" | "edit" | "hold" | "release_hold" | "gate_out" | "move";

export interface CarEvent {
  id: number;
  at: string;
  actor_name: string | null;
  action: string;
  changes: Record<string, [unknown, unknown]> | null;
  reason: string | null;
  /** For a move: how the place was chosen, and on which phone or PC. */
  via?: string | null;
  device?: string | null;
}

export const CAR_EVENT_LABEL: Record<CarEventAction, string> = {
  gate_in: "Arrived (gate-in)",
  edit: "Edited",
  hold: "Put on hold",
  release_hold: "Hold released",
  gate_out: "Left the lot (gate-out)",
  move: "Moved",
};

const VIA_LABEL: Record<string, string> = { scan: "scanned", list: "picked from the list", typed: "typed" };

/** "scanned, on device-7f3a" for a move; empty for every other event. */
export function eventHow(e: Pick<CarEvent, "via" | "device">): string {
  const how = e.via ? VIA_LABEL[e.via] ?? e.via : "";
  return [how, e.device ? `on ${e.device}` : ""].filter(Boolean).join(", ");
}

const FIELD_LABEL: Record<string, string> = {
  vin: "VIN", model: "Model", model_year: "Year", color: "Colour",
  lot_zone: "Zone", lot_slot: "Slot", odometer_in: "Odometer at arrival", odometer_out: "Odometer at departure",
  key_count: "Keys", driver_name: "Driver", truck_number: "Truck number",
  gate_out_driver_name: "Driver out", gate_out_truck_number: "Truck out",
  free_days: "Free days", daily_rate: "Daily rate", fees: "Fees", gate_in_time: "Arrival time",
};

/** Fields not worth a line: status is the event itself, the hold reason has its own line, and a
 *  slot's id says nothing that its zone and slot lines don't. */
const HIDDEN = new Set(["status", "hold_reason", "location_id"]);

const show = (v: unknown): string => (v === null || v === undefined || v === "" ? "—" : String(v));

export function eventLabel(action: string): string {
  return CAR_EVENT_LABEL[action as CarEventAction] ?? action;
}

/** "Colour: White → Blue" for each field that changed, in a stable order. */
export function eventChangeLines(e: Pick<CarEvent, "action" | "changes">): string[] {
  const ch = e.changes ?? {};
  const order = Object.keys(FIELD_LABEL);
  return Object.keys(ch)
    .filter((k) => !HIDDEN.has(k))
    .sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99))
    .map((k) => {
      const [from, to] = ch[k] ?? [null, null];
      const label = FIELD_LABEL[k] ?? k;
      // a gate-out fills fields that were empty: show the new value only
      return e.action === "gate_out" && (from === null || from === undefined) ? `${label}: ${show(to)}` : `${label}: ${show(from)} → ${show(to)}`;
    });
}
