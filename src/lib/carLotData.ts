import { supabase } from "@/integrations/supabase/client";
import type { VisitStatus } from "@/lib/carLot";
import { inspectionState, type LotVisit } from "@/lib/carLotStats";
import { fetchAllRows } from "@/lib/fetchAllRows";

/**
 * Reads the car lot's visits for the Overview page and the reports, always
 * with the signed-in user's own login, so row-level security decides what is
 * returned (a car lot's staff see their lot, the owner sees every lot).
 */

const VISIT_COLUMNS =
  "id, ticket_number, status, gate_in_time, gate_out_time, free_days, lot_zone, lot_slot, hold_reason, held_at, vehicles(vin, model, model_year, color), manufacturers(code, name), vehicle_inspections(phase, status)";

interface VisitRow {
  id: string;
  ticket_number: number;
  status: VisitStatus;
  gate_in_time: string;
  gate_out_time: string | null;
  free_days: number;
  lot_zone: string | null;
  lot_slot: string | null;
  hold_reason: string | null;
  held_at: string | null;
  vehicles: { vin: string; model: string | null; model_year: number | null; color: string | null } | null;
  manufacturers: { code: string; name: string } | null;
  vehicle_inspections: { phase: string; status: string }[] | null;
}

export function toLotVisit(r: VisitRow): LotVisit {
  return {
    id: r.id,
    ticketNumber: r.ticket_number,
    status: r.status,
    gateIn: new Date(r.gate_in_time),
    gateOut: r.gate_out_time ? new Date(r.gate_out_time) : null,
    freeDays: r.free_days,
    zone: r.lot_zone,
    slot: r.lot_slot,
    vin: r.vehicles?.vin ?? "",
    model: r.vehicles?.model ?? null,
    modelYear: r.vehicles?.model_year ?? null,
    color: r.vehicles?.color ?? null,
    manufacturerCode: r.manufacturers?.code ?? "",
    manufacturerName: r.manufacturers?.name ?? "",
    holdReason: r.hold_reason,
    heldAt: r.held_at ? new Date(r.held_at) : null,
    arrivalInspection: inspectionState(r.vehicle_inspections, "gate_in"),
    departureInspection: inspectionState(r.vehicle_inspections, "gate_out"),
  };
}

/** One row per visit, whichever query returned it. */
function uniqueById(rows: VisitRow[]): LotVisit[] {
  return [...new Map(rows.map((r) => [r.id, r])).values()].map(toLotVisit);
}

const visits = () => supabase.from("vehicle_visits").select(VISIT_COLUMNS);

/** Midnight (local) at the start of the first of the last `days` days. */
export function windowStart(now: Date, days: number): Date {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - (days - 1));
  return start;
}

/** Every car in the lot now, plus every car that arrived or left in the last `days` days. */
export async function loadOverviewVisits(yardId: string, now: Date, days: number): Promise<LotVisit[]> {
  const since = windowStart(now, days).toISOString();
  const [open, recent] = await Promise.all([
    fetchAllRows<VisitRow>((from, to) =>
      visits().eq("yard_id", yardId).in("status", ["in-lot", "on-hold"])
        .order("gate_in_time").order("id").range(from, to)),
    fetchAllRows<VisitRow>((from, to) =>
      visits().eq("yard_id", yardId).or(`gate_in_time.gte.${since},gate_out_time.gte.${since}`)
        .order("gate_in_time").order("id").range(from, to)),
  ]);
  return uniqueById([...open, ...recent]);
}
