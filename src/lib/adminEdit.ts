import { supabase } from "@/integrations/supabase/client";

/**
 * Admin corrections to container, visit and booking records.
 *
 * The work happens in the admin_edit_container / admin_edit_booking RPCs, each
 * one transaction: they check the caller is a yard admin, validate every value,
 * apply the changes and write one activity_log row listing each field's old and
 * new value with the admin's reason. Their error messages are written for the
 * admin, so callers can show `error` in a toast verbatim.
 */

export type ContainerEditField =
  | "container_number"
  | "shipping_line"
  | "container_type"
  | "driver_name"
  | "truck_number"
  | "gate_in_time"
  | "yard_block"
  | "yard_row"
  | "gate_out_driver_name"
  | "gate_out_truck_number"
  | "gate_out_time"
  | "seal_number"
  | "fees"
  | "port_arrival_date"
  | "free_days";

export type BookingEditField =
  | "customer_name"
  | "booking_number"
  | "shipping_line"
  | "total_containers"
  | "status";

export const FIELD_LABELS: Record<ContainerEditField | BookingEditField, string> = {
  container_number: "Container number",
  shipping_line: "Shipping line",
  container_type: "Type / size",
  driver_name: "Gate-in driver",
  truck_number: "Gate-in truck",
  gate_in_time: "Gate-in time",
  yard_block: "Block",
  yard_row: "Row",
  gate_out_driver_name: "Gate-out driver",
  gate_out_truck_number: "Gate-out truck",
  gate_out_time: "Gate-out time",
  seal_number: "Seal",
  fees: "Gate-out fees (JOD)",
  port_arrival_date: "Port arrival date",
  free_days: "Free days",
  customer_name: "Customer",
  booking_number: "Booking number",
  total_containers: "Containers booked",
  status: "Status",
};

export type EditValue = string | number | null;

/** One logged change, as the RPCs record it in activity_log.metadata.changes. */
export interface LoggedChange {
  field: string;
  from: EditValue;
  to: EditValue;
}

const TIME_FIELDS = new Set(["gate_in_time", "gate_out_time"]);

/** Blank strings count as "no value", and text is compared trimmed. */
const normalize = (v: EditValue | undefined): EditValue => {
  if (v === undefined || v === null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const t = v.trim();
  return t === "" ? null : t;
};

/**
 * The fields whose value differs between the record and the form, with the
 * form's value. Only these are sent, so the log lists exactly what changed.
 */
export function diffEdits<F extends string>(
  original: Partial<Record<F, EditValue>>,
  edited: Partial<Record<F, EditValue>>,
): Partial<Record<F, EditValue>> {
  const changes: Partial<Record<F, EditValue>> = {};
  for (const key of Object.keys(edited) as F[]) {
    const before = normalize(original[key]);
    const after = normalize(edited[key]);
    // A number field may come back as the string an input holds ("12.5").
    const same =
      before === after || (before !== null && after !== null && Number(before) === Number(after));
    if (!same) changes[key] = after;
  }
  return changes;
}

/** Date → the `yyyy-MM-ddTHH:mm` a datetime-local input shows, in local time. */
export function toLocalInput(d: Date | undefined | null): string {
  if (!d) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Turns datetime-local strings into ISO instants before they go to the RPC. */
export function toRpcChanges<F extends string>(changes: Partial<Record<F, EditValue>>): Record<string, EditValue> {
  const out: Record<string, EditValue> = {};
  for (const [k, v] of Object.entries(changes) as [string, EditValue][]) {
    out[k] = TIME_FIELDS.has(k) && typeof v === "string" ? new Date(v).toISOString() : v;
  }
  return out;
}

const showValue = (field: string, v: EditValue): string => {
  if (v === null || v === "") return "—";
  // Calendar dates (the port arrival date) read as DD/MM/YYYY, with no time-zone shift.
  const day = field === "port_arrival_date" && typeof v === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
  if (day) return `${day[3]}/${day[2]}/${day[1]}`;
  if (TIME_FIELDS.has(field) && typeof v === "string") {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) {
      return `${d.toLocaleDateString("en-GB")} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
    }
  }
  return String(v);
};

/** "Shipping line: SLD → WOM" — how a change reads in the Activity Log. */
export function describeChange(c: LoggedChange): string {
  const label = FIELD_LABELS[c.field as ContainerEditField] ?? c.field;
  return `${label}: ${showValue(c.field, c.from)} → ${showValue(c.field, c.to)}`;
}

interface RpcResult {
  ok: boolean;
  changes: LoggedChange[];
  error?: string;
}

export async function adminEditContainer(
  visitId: string,
  changes: Partial<Record<ContainerEditField, EditValue>>,
  reason: string,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("admin_edit_container", {
    _visit_id: visitId,
    _changes: toRpcChanges(changes),
    _reason: reason.trim(),
  });
  if (error) return { ok: false, changes: [], error: error.message };
  return { ok: true, changes: (data ?? []) as unknown as LoggedChange[] };
}

export async function adminEditBooking(
  bookingId: string,
  changes: Partial<Record<BookingEditField, EditValue>>,
  reason: string,
): Promise<RpcResult> {
  const { data, error } = await supabase.rpc("admin_edit_booking", {
    _booking_id: bookingId,
    _changes: changes,
    _reason: reason.trim(),
  });
  if (error) return { ok: false, changes: [], error: error.message };
  return { ok: true, changes: (data ?? []) as unknown as LoggedChange[] };
}
