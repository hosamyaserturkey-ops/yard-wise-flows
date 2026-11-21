import { supabase } from "@/integrations/supabase/client";
import type { VisitStatus } from "@/lib/carLot";
import { inspectionState, type LotVisit } from "@/lib/carLotStats";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { pairHolds, type HoldEvent, type LotHold, type LotReportVisit } from "@/lib/reports/carLotReportData";
import { fetchNames } from "@/lib/reports/fetchReportData";

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

const REPORT_COLUMNS =
  "id, ticket_number, status, gate_in_time, gate_out_time, free_days, lot_zone, lot_slot, hold_reason, held_at, driver_name, truck_number, gate_out_driver_name, gate_out_truck_number, odometer_in, odometer_out, created_by, gated_out_by, vehicles(vin, model, model_year, color), manufacturers(code, name), vehicle_inspections(id, phase, status)";

interface ReportVisitRow extends VisitRow {
  driver_name: string | null;
  truck_number: string | null;
  gate_out_driver_name: string | null;
  gate_out_truck_number: string | null;
  odometer_in: number | null;
  odometer_out: number | null;
  created_by: string | null;
  gated_out_by: string | null;
  vehicle_inspections: { id: string; phase: string; status: string }[] | null;
}

export interface LotReportData {
  visits: LotReportVisit[];
  holds: LotHold[];
}

/**
 * Everything the car-lot reports need: the visits in the lot at any moment of
 * the period, every car in the lot now (the stock report is a snapshot), the
 * notes written with their damage photos, their holds, and who received and
 * released each car (best-effort: a name the user may not read stays blank).
 */
export async function loadLotReportData(
  yardId: string, period: { from?: Date; to?: Date }, now: Date,
): Promise<LotReportData> {
  const until = (period.to && period.to < now ? period.to : now).toISOString();
  const reportVisits = () => supabase.from("vehicle_visits").select(REPORT_COLUMNS).eq("yard_id", yardId);
  const [overlapping, open] = await Promise.all([
    fetchAllRows<ReportVisitRow>((from, to) => {
      let q = reportVisits().lte("gate_in_time", until);
      if (period.from) q = q.or(`gate_out_time.is.null,gate_out_time.gte.${period.from.toISOString()}`);
      return q.order("gate_in_time").order("id").range(from, to);
    }),
    fetchAllRows<ReportVisitRow>((from, to) =>
      reportVisits().in("status", ["in-lot", "on-hold"]).order("gate_in_time").order("id").range(from, to)),
  ]);
  const rows = [...new Map([...overlapping, ...open].map((r) => [r.id, r])).values()];
  if (rows.length === 0) return { visits: [], holds: [] };

  // Photos and holds can't predate the earliest arrival in the set.
  const since = new Date(Math.min(...rows.map((r) => new Date(r.gate_in_time).getTime()))).toISOString();
  const inspectionOf = new Map<string, { visitId: string; phase: string }>();
  for (const r of rows) for (const i of r.vehicle_inspections ?? []) inspectionOf.set(i.id, { visitId: r.id, phase: i.phase });

  const [photos, events, names] = await Promise.all([
    fetchAllRows<{ inspection_id: string; note: string | null }>((from, to) =>
      supabase.from("vehicle_inspection_photos").select("inspection_id, note")
        .eq("yard_id", yardId).eq("angle", "damage").gte("created_at", since)
        .order("created_at").order("id").range(from, to)),
    fetchAllRows<{ visit_id: string | null; at: string; action: string; actor_name: string | null; reason: string | null }>((from, to) =>
      supabase.from("vehicle_events").select("visit_id, at, action, actor_name, reason")
        .eq("yard_id", yardId).in("action", ["hold", "release_hold"]).gte("at", since)
        .order("at").order("id").range(from, to)),
    fetchNames(rows.flatMap((r) => [r.created_by ?? "", r.gated_out_by ?? ""])),
  ]);

  const damage = new Map<string, { in: string[]; out: string[] }>();
  for (const p of photos) {
    const where = inspectionOf.get(p.inspection_id);
    if (!where) continue;
    const notes = damage.get(where.visitId) ?? { in: [], out: [] };
    (where.phase === "gate_out" ? notes.out : notes.in).push(p.note ?? "");
    damage.set(where.visitId, notes);
  }

  const visits: LotReportVisit[] = rows.map((r) => ({
    ...toLotVisit(r),
    driverIn: r.driver_name,
    truckIn: r.truck_number,
    driverOut: r.gate_out_driver_name,
    truckOut: r.gate_out_truck_number,
    odometerIn: r.odometer_in,
    odometerOut: r.odometer_out,
    receivedBy: (r.created_by && names.get(r.created_by)) || null,
    releasedBy: (r.gated_out_by && names.get(r.gated_out_by)) || null,
    damageIn: damage.get(r.id)?.in ?? [],
    damageOut: damage.get(r.id)?.out ?? [],
  }));

  const holdEvents: HoldEvent[] = events
    .filter((e): e is typeof e & { visit_id: string } => !!e.visit_id)
    .map((e) => ({
      visitId: e.visit_id,
      at: new Date(e.at),
      action: e.action === "hold" ? "hold" : "release_hold",
      actorName: e.actor_name,
      reason: e.reason,
    }));
  return { visits, holds: pairHolds(holdEvents, visits) };
}
