// The car lot's Excel reports. Like reportData.ts for the container yard:
// plain rows in, a ReportSpec out (workbook.ts renders it), so every number
// can be unit-tested without Excel or Supabase. Days count as on the Cars list
// and the manufacturer portal: the day a car arrives is day 1.

import { VISIT_STATUS_LABEL } from "@/lib/carLot";
import {
  ageBands, isInLot, lotDays, overFreeDays, stockByManufacturer, type InspectionState, type LotVisit,
} from "@/lib/carLotStats";
import { formatDateTime, formatMonthYear } from "@/lib/format";
import type { CellValue, ReportKpi, ReportSpec, ReportTable } from "./reportModel";
import { baseMeta, dwellDays, fileName, periodLabel, type ReportContext } from "./reportData";

/** Holds (like every change to a car) are in the car's history from this day on. */
export const HISTORY_SINCE = "21 Nov 2026";

/** A visit with what the reports print beyond the overview's fields. */
export interface LotReportVisit extends LotVisit {
  driverIn: string | null;
  truckIn: string | null;
  driverOut: string | null;
  truckOut: string | null;
  odometerIn: number | null;
  odometerOut: number | null;
  receivedBy: string | null;
  releasedBy: string | null;
  /** The note written with each damage photo of the arrival inspection, oldest first. */
  damageIn: string[];
  /** The same for the departure inspection. */
  damageOut: string[];
}

/** A hold or a hold release, as the car's history recorded it. */
export interface HoldEvent {
  visitId: string;
  at: Date;
  action: "hold" | "release_hold";
  actorName: string | null;
  reason: string | null;
}

/** One hold of a car, from it being put on hold to its release. */
export interface LotHold {
  visitId: string;
  /** null: the hold began before the history was recorded. */
  start: Date | null;
  startedBy: string | null;
  reason: string | null;
  /** null: the car is still on hold. */
  end: Date | null;
  endedBy: string | null;
}

export interface CarLotReportContext extends ReportContext {
  yardId: string;
}

export type LotReportKind = "stock" | "movements" | "dwell" | "damage" | "holds";

type Period = ReportContext["period"];

const INSPECTION_LABEL: Record<InspectionState, string> = { closed: "Closed", open: "Open", missing: "Not started" };

const inPeriod = (d: Date | null | undefined, p: Period): d is Date =>
  !!d && (!p.from || d >= p.from) && (!p.to || d <= p.to);

const average1 = (xs: number[]): number =>
  xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : 0;

const noteList = (notes: string[]): string => notes.map((n) => n.trim() || "(no note)").join("; ");

const percent = (part: number, whole: number): string => (whole ? `${Math.round((part / whole) * 100)}%` : "—");

const numberRow = (n: number) => ({ "#": n });

const yardOf = (ctx: CarLotReportContext): string => ctx.yardNames[ctx.yardId] ?? "Car lot";

const model = (v: LotVisit): string => [v.model, v.modelYear, v.color].filter(Boolean).join(" · ");

/** As far as a report can see: the period's end, or now when that is earlier or there is no end. */
function periodEnd(p: Period, now: Date): Date {
  return p.to && p.to < now ? p.to : now;
}

/** The cars in the lot at one instant: arrived by then and not released yet. */
function inLotAt<T extends Pick<LotVisit, "gateIn" | "gateOut">>(visits: T[], at: Date): T[] {
  return visits.filter((v) => v.gateIn <= at && (!v.gateOut || v.gateOut > at));
}

// ── preview on the Reports page ─────────────────────────────────────────────

export interface LotPeriodSummary {
  arrivals: number;
  releases: number;
  /** Average days in the lot of the cars released in the period. */
  avgDaysReleased: number;
  /** Cars in the lot at the end of the period (or now). */
  inLotAtEnd: number;
}

export function lotPeriodSummary(visits: LotVisit[], period: Period, now: Date): LotPeriodSummary {
  const released = visits.filter((v) => inPeriod(v.gateOut, period));
  return {
    arrivals: visits.filter((v) => inPeriod(v.gateIn, period)).length,
    releases: released.length,
    avgDaysReleased: average1(released.map((v) => lotDays(v, now))),
    inLotAtEnd: inLotAt(visits, periodEnd(period, now)).length,
  };
}

// ── holds from the history ──────────────────────────────────────────────────

/**
 * Pairs each "put on hold" with the release that ended it, per car. A release
 * with no recorded start is a hold that began before the history existed; a
 * car on hold now with no recorded start gets its hold from the car record.
 */
export function pairHolds(events: HoldEvent[], visits: LotVisit[]): LotHold[] {
  const holds: LotHold[] = [];
  const byVisit = new Map<string, HoldEvent[]>();
  for (const e of events) byVisit.set(e.visitId, [...(byVisit.get(e.visitId) ?? []), e]);
  for (const [visitId, list] of byVisit) {
    let open: LotHold | null = null;
    for (const e of [...list].sort((a, b) => a.at.getTime() - b.at.getTime())) {
      if (e.action === "hold") {
        if (open) holds.push(open);
        open = { visitId, start: e.at, startedBy: e.actorName, reason: e.reason, end: null, endedBy: null };
      } else if (open) {
        holds.push({ ...open, end: e.at, endedBy: e.actorName });
        open = null;
      } else {
        holds.push({ visitId, start: null, startedBy: null, reason: null, end: e.at, endedBy: e.actorName });
      }
    }
    if (open) holds.push(open);
  }
  for (const v of visits) {
    if (v.status !== "on-hold" || holds.some((h) => h.visitId === v.id && !h.end)) continue;
    holds.push({ visitId: v.id, start: v.heldAt, startedBy: null, reason: v.holdReason, end: null, endedBy: null });
  }
  return holds;
}

// ── 1. Cars in the lot (a snapshot, now) ────────────────────────────────────

export function buildLotStockReport(visits: LotReportVisit[], ctx: CarLotReportContext): ReportSpec {
  const { now } = ctx;
  const cars = visits.filter(isInLot).sort((a, b) => a.gateIn.getTime() - b.gateIn.getTime());
  const days = cars.map((v) => lotDays(v, now));

  const kpis: ReportKpi[] = [
    { label: "Cars in the lot", value: cars.length, format: "int" },
    { label: "On hold", value: cars.filter((v) => v.status === "on-hold").length, format: "int" },
    { label: "Over their free days", value: cars.filter((v) => overFreeDays(v, now) > 0).length, format: "int" },
    { label: "Average days in the lot", value: average1(days), format: "decimal1" },
    { label: "Longest stay (days)", value: days.length ? Math.max(...days) : 0, format: "int" },
    { label: "Arrival inspection not closed", value: cars.filter((v) => v.arrivalInspection !== "closed").length, format: "int" },
  ];

  const makers: ReportTable = {
    title: "Cars in the lot by manufacturer",
    columns: [
      { key: "name", header: "Manufacturer", width: 22, total: "label" },
      { key: "code", header: "Code", width: 8 },
      { key: "inLot", header: "In the lot", width: 11, format: "int", total: "sum" },
      { key: "onHold", header: "On hold", width: 10, format: "int", total: "sum" },
      { key: "overFree", header: "Over free days", width: 14, format: "int", total: "sum" },
      { key: "avgDays", header: "Average days", width: 13, format: "decimal1" },
      { key: "oldestDays", header: "Longest (days)", width: 14, format: "int" },
    ],
    rows: stockByManufacturer(cars, now).map((m) => ({ ...m })),
    totals: true,
  };

  const bands: ReportTable = {
    title: "Days in the lot",
    columns: [
      { key: "label", header: "Days in the lot", width: 22, total: "label" },
      { key: "count", header: "Cars", width: 11, format: "int", total: "sum" },
    ],
    rows: ageBands(cars, now).map((b) => ({ label: b.label, count: b.count })),
    totals: true,
    note: "The day a car arrives is day 1, as on the Cars list.",
  };

  const detail: ReportTable = {
    columns: [
      { key: "#", header: "#", width: 6, format: "int", total: "label" },
      { key: "ticket", header: "Ticket", width: 9, format: "int" },
      { key: "vin", header: "VIN", width: 21, total: "count" },
      { key: "manufacturer", header: "Manufacturer", width: 18 },
      { key: "model", header: "Model", width: 24 },
      { key: "arrived", header: "Arrived", width: 18, format: "datetime" },
      { key: "days", header: "Days in the lot", width: 14, format: "int", total: "average" },
      { key: "freeDays", header: "Free days", width: 10, format: "int" },
      { key: "overFree", header: "Days over free", width: 14, format: "int", total: "sum" },
      { key: "zone", header: "Zone", width: 8 },
      { key: "slot", header: "Slot", width: 8 },
      { key: "status", header: "Status", width: 10 },
      { key: "holdReason", header: "Hold reason", width: 28 },
      { key: "heldSince", header: "On hold since", width: 18, format: "datetime" },
      { key: "inspection", header: "Arrival inspection", width: 17 },
      { key: "damageCount", header: "Damage photos", width: 14, format: "int", total: "sum" },
      { key: "damageNotes", header: "Damage noted at arrival", width: 40 },
      { key: "receivedBy", header: "Received by", width: 18 },
    ],
    rows: cars.map((v, i) => ({
      ...numberRow(i + 1),
      ticket: v.ticketNumber,
      vin: v.vin,
      manufacturer: v.manufacturerName,
      model: model(v),
      arrived: v.gateIn,
      days: lotDays(v, now),
      freeDays: v.freeDays,
      overFree: overFreeDays(v, now),
      zone: v.zone ?? "",
      slot: v.slot ?? "",
      status: VISIT_STATUS_LABEL[v.status],
      holdReason: v.status === "on-hold" ? v.holdReason ?? "" : "",
      heldSince: v.status === "on-hold" ? v.heldAt : null,
      inspection: INSPECTION_LABEL[v.arrivalInspection],
      damageCount: v.damageIn.length,
      damageNotes: noteList(v.damageIn),
      receivedBy: v.receivedBy ?? "",
    })),
    totals: true,
    note: "Longest in the lot first. Damage photos and their notes are in the app (Cars, then In).",
  };

  return {
    title: "Car Lot Stock Report",
    meta: baseMeta(ctx, yardOf(ctx), [["Snapshot", formatDateTime(now)]]),
    fileName: fileName("Car_Stock", [ctx.yardId], ctx),
    sheets: [
      { name: "Summary", kpis, tables: [makers, bands] },
      { name: "Cars in the lot", tables: [detail], detail: true },
    ],
  };
}

// ── 2. Movements (the period) ───────────────────────────────────────────────

export interface LotMove {
  at: Date;
  direction: "In" | "Out";
  visit: LotReportVisit;
}

/** Every arrival and release inside the period, oldest first. */
export function lotMoves(visits: LotReportVisit[], period: Period): LotMove[] {
  const moves: LotMove[] = [];
  for (const v of visits) {
    if (inPeriod(v.gateIn, period)) moves.push({ at: v.gateIn, direction: "In", visit: v });
    const out = v.gateOut;
    if (inPeriod(out, period)) moves.push({ at: out, direction: "Out", visit: v });
  }
  return moves.sort((a, b) => a.at.getTime() - b.at.getTime() || (a.direction === "In" ? -1 : 1));
}

export interface LotMonthRow {
  month: string;
  manufacturer: string;
  arrivals: number;
  releases: number;
  /** Cars in the lot at the end of the month (or of the period, or now, whichever is first). */
  inLotAtEnd: number;
  /** Average days in the lot of the cars released that month; null when none was. */
  avgDaysReleased: number | null;
}

/** Month by month, per manufacturer, inside the period. Months with nothing to show are left out. */
export function lotMonthRows(visits: LotReportVisit[], period: Period, now: Date): LotMonthRow[] {
  const end = periodEnd(period, now);
  const first = period.from ?? (visits.length ? new Date(Math.min(...visits.map((v) => v.gateIn.getTime()))) : end);
  const makers = [...new Map(visits.map((v) => [v.manufacturerCode || v.manufacturerName, v.manufacturerName])).entries()]
    .sort((a, b) => a[1].localeCompare(b[1]));
  const rows: LotMonthRow[] = [];
  for (let m = new Date(first.getFullYear(), first.getMonth(), 1); m <= end; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
    const lastMoment = new Date(new Date(m.getFullYear(), m.getMonth() + 1, 1).getTime() - 1);
    const month: Period = {
      from: period.from && period.from > m ? period.from : m,
      to: period.to && period.to < lastMoment ? period.to : lastMoment,
    };
    const monthEnd = lastMoment < end ? lastMoment : end;
    for (const [key, name] of makers) {
      const mine = visits.filter((v) => (v.manufacturerCode || v.manufacturerName) === key);
      const released = mine.filter((v) => inPeriod(v.gateOut, month));
      const row: LotMonthRow = {
        month: formatMonthYear(m),
        manufacturer: name,
        arrivals: mine.filter((v) => inPeriod(v.gateIn, month)).length,
        releases: released.length,
        inLotAtEnd: inLotAt(mine, monthEnd).length,
        avgDaysReleased: released.length ? average1(released.map((v) => lotDays(v, now))) : null,
      };
      if (row.arrivals || row.releases || row.inLotAtEnd) rows.push(row);
    }
  }
  return rows;
}

export function buildLotMovementsReport(visits: LotReportVisit[], ctx: CarLotReportContext): ReportSpec {
  const { now, period } = ctx;
  const moves = lotMoves(visits, period);
  const ins = moves.filter((m) => m.direction === "In").length;
  const outs = moves.length - ins;

  const kpis: ReportKpi[] = [
    { label: "Arrivals", value: ins, format: "int" },
    { label: "Releases", value: outs, format: "int" },
    { label: "Net change", value: ins - outs, format: "int" },
    { label: "In the lot at the end", value: inLotAt(visits, periodEnd(period, now)).length, format: "int" },
  ];

  const makers = [...new Set(moves.map((m) => m.visit.manufacturerName))].sort();
  const byMaker: ReportTable = {
    title: "Arrivals and releases by manufacturer",
    columns: [
      { key: "manufacturer", header: "Manufacturer", width: 22, total: "label" },
      { key: "arrivals", header: "Arrivals", width: 11, format: "int", total: "sum" },
      { key: "releases", header: "Releases", width: 11, format: "int", total: "sum" },
    ],
    rows: makers.map((name) => ({
      manufacturer: name,
      arrivals: moves.filter((m) => m.direction === "In" && m.visit.manufacturerName === name).length,
      releases: moves.filter((m) => m.direction === "Out" && m.visit.manufacturerName === name).length,
    })),
    totals: true,
  };

  const monthly: ReportTable = {
    columns: [
      { key: "month", header: "Month", width: 16, total: "label" },
      { key: "manufacturer", header: "Manufacturer", width: 22 },
      { key: "arrivals", header: "Arrivals", width: 11, format: "int", total: "sum" },
      { key: "releases", header: "Releases", width: 11, format: "int", total: "sum" },
      { key: "inLotAtEnd", header: "In the lot at month end", width: 22, format: "int" },
      { key: "avgDaysReleased", header: "Average days (released)", width: 22, format: "decimal1" },
    ],
    rows: lotMonthRows(visits, period, now).map((r) => ({ ...r })),
    totals: true,
    note: "A month that is not over yet counts up to the end of the period, or now.",
  };

  const detail: ReportTable = {
    columns: [
      { key: "#", header: "#", width: 6, format: "int", total: "label" },
      { key: "at", header: "Date & time", width: 18, format: "datetime" },
      { key: "direction", header: "In / Out", width: 9 },
      { key: "ticket", header: "Ticket", width: 9, format: "int" },
      { key: "vin", header: "VIN", width: 21, total: "count" },
      { key: "manufacturer", header: "Manufacturer", width: 18 },
      { key: "model", header: "Model", width: 24 },
      { key: "driver", header: "Driver", width: 18 },
      { key: "truck", header: "Truck", width: 12 },
      { key: "odometer", header: "Odometer (km)", width: 14, format: "int" },
      { key: "by", header: "Handled by", width: 18 },
    ],
    rows: moves.map((m, i) => {
      const v = m.visit;
      const isIn = m.direction === "In";
      return {
        ...numberRow(i + 1),
        at: m.at,
        direction: m.direction,
        ticket: v.ticketNumber,
        vin: v.vin,
        manufacturer: v.manufacturerName,
        model: model(v),
        driver: (isIn ? v.driverIn : v.driverOut) ?? "",
        truck: (isIn ? v.truckIn : v.truckOut) ?? "",
        odometer: isIn ? v.odometerIn : v.odometerOut,
        by: (isIn ? v.receivedBy : v.releasedBy) ?? "",
      };
    }),
    totals: true,
  };

  return {
    title: "Car Lot Movements Report",
    meta: baseMeta(ctx, yardOf(ctx), [["Period", periodLabel(period)]]),
    fileName: fileName("Car_Movements", [ctx.yardId], ctx),
    sheets: [
      { name: "Summary", kpis, tables: [byMaker] },
      { name: "By month", tables: [monthly], detail: true },
      { name: "Movements", tables: [detail], detail: true },
    ],
  };
}

// ── 3. Dwell time (cars released in the period) ─────────────────────────────

export function buildLotDwellReport(visits: LotReportVisit[], ctx: CarLotReportContext): ReportSpec {
  const { now, period } = ctx;
  const released = visits
    .filter((v) => inPeriod(v.gateOut, period))
    .sort((a, b) => (a.gateOut as Date).getTime() - (b.gateOut as Date).getTime());
  const days = released.map((v) => lotDays(v, now));
  const over = released.map((v) => overFreeDays(v, now));

  const kpis: ReportKpi[] = [
    { label: "Cars released", value: released.length, format: "int" },
    { label: "Average days in the lot", value: average1(days), format: "decimal1" },
    { label: "Longest stay (days)", value: days.length ? Math.max(...days) : 0, format: "int" },
    { label: "Released past their free days", value: over.filter((d) => d > 0).length, format: "int" },
    { label: "Days over free, all cars", value: over.reduce((a, b) => a + b, 0), format: "int" },
  ];

  const makers = [...new Set(released.map((v) => v.manufacturerName))].sort();
  const byMaker: ReportTable = {
    title: "By manufacturer",
    columns: [
      { key: "manufacturer", header: "Manufacturer", width: 22, total: "label" },
      { key: "released", header: "Released", width: 11, format: "int", total: "sum" },
      { key: "avgDays", header: "Average days", width: 13, format: "decimal1" },
      { key: "overCars", header: "Past free days", width: 14, format: "int", total: "sum" },
      { key: "overDays", header: "Days over free", width: 14, format: "int", total: "sum" },
    ],
    rows: makers.map((name) => {
      const mine = released.filter((v) => v.manufacturerName === name);
      const mineOver = mine.map((v) => overFreeDays(v, now));
      return {
        manufacturer: name,
        released: mine.length,
        avgDays: average1(mine.map((v) => lotDays(v, now))),
        overCars: mineOver.filter((d) => d > 0).length,
        overDays: mineOver.reduce((a, b) => a + b, 0),
      };
    }),
    totals: true,
    note: "Days over free are counted, not charged: the car lot has no prices yet.",
  };

  const detail: ReportTable = {
    columns: [
      { key: "#", header: "#", width: 6, format: "int", total: "label" },
      { key: "ticket", header: "Ticket", width: 9, format: "int" },
      { key: "vin", header: "VIN", width: 21, total: "count" },
      { key: "manufacturer", header: "Manufacturer", width: 18 },
      { key: "model", header: "Model", width: 24 },
      { key: "arrived", header: "Arrived", width: 18, format: "datetime" },
      { key: "released", header: "Released", width: 18, format: "datetime" },
      { key: "days", header: "Days in the lot", width: 14, format: "int", total: "average" },
      { key: "freeDays", header: "Free days", width: 10, format: "int" },
      { key: "overFree", header: "Days over free", width: 14, format: "int", total: "sum" },
      { key: "releasedBy", header: "Released by", width: 18 },
    ],
    rows: released.map((v, i) => ({
      ...numberRow(i + 1),
      ticket: v.ticketNumber,
      vin: v.vin,
      manufacturer: v.manufacturerName,
      model: model(v),
      arrived: v.gateIn,
      released: v.gateOut,
      days: lotDays(v, now),
      freeDays: v.freeDays,
      overFree: overFreeDays(v, now),
      releasedBy: v.releasedBy ?? "",
    })),
    totals: true,
    note: "Days in the lot count the arrival day as day 1 and stop at the release.",
  };

  return {
    title: "Car Lot Dwell Time Report",
    meta: baseMeta(ctx, yardOf(ctx), [["Period", periodLabel(period)], ["Cars", "Released in the period"]]),
    fileName: fileName("Car_Dwell_Time", [ctx.yardId], ctx),
    sheets: [
      { name: "Summary", kpis, tables: [byMaker] },
      { name: "Released cars", tables: [detail], detail: true },
    ],
  };
}

// ── 4. Damage (cars that arrived or left in the period) ─────────────────────

export function buildLotDamageReport(visits: LotReportVisit[], ctx: CarLotReportContext): ReportSpec {
  const { period } = ctx;
  const cars = visits
    .filter((v) => inPeriod(v.gateIn, period) || inPeriod(v.gateOut, period))
    .sort((a, b) => a.gateIn.getTime() - b.gateIn.getTime());
  const arrived = cars.filter((v) => inPeriod(v.gateIn, period));
  const left = cars.filter((v) => inPeriod(v.gateOut, period));
  const damagedIn = arrived.filter((v) => v.damageIn.length > 0).length;
  const damagedOut = left.filter((v) => v.damageOut.length > 0).length;

  const kpis: ReportKpi[] = [
    { label: "Cars arrived", value: arrived.length, format: "int" },
    { label: "Arrived with damage noted", value: damagedIn, format: "int" },
    { label: "Share of arrivals with damage", value: percent(damagedIn, arrived.length) },
    { label: "Cars released", value: left.length, format: "int" },
    { label: "Released with damage noted at departure", value: damagedOut, format: "int" },
    { label: "Share of releases with damage", value: percent(damagedOut, left.length) },
  ];

  const detail: ReportTable = {
    columns: [
      { key: "#", header: "#", width: 6, format: "int", total: "label" },
      { key: "ticket", header: "Ticket", width: 9, format: "int" },
      { key: "vin", header: "VIN", width: 21, total: "count" },
      { key: "manufacturer", header: "Manufacturer", width: 18 },
      { key: "model", header: "Model", width: 24 },
      { key: "arrived", header: "Arrived", width: 18, format: "datetime" },
      { key: "inInspection", header: "Arrival inspection", width: 17 },
      { key: "inCount", header: "Damage photos (arrival)", width: 14, format: "int", total: "sum" },
      { key: "inNotes", header: "Noted at arrival", width: 40 },
      { key: "released", header: "Released", width: 18, format: "datetime" },
      { key: "outInspection", header: "Departure inspection", width: 19 },
      { key: "outCount", header: "Damage photos (departure)", width: 14, format: "int", total: "sum" },
      { key: "outNotes", header: "Noted at departure", width: 40 },
    ],
    rows: cars.map((v, i) => ({
      ...numberRow(i + 1),
      ticket: v.ticketNumber,
      vin: v.vin,
      manufacturer: v.manufacturerName,
      model: model(v),
      arrived: v.gateIn,
      inInspection: INSPECTION_LABEL[v.arrivalInspection],
      inCount: v.damageIn.length,
      inNotes: noteList(v.damageIn),
      released: v.gateOut,
      outInspection: v.gateOut || v.departureInspection !== "missing" ? INSPECTION_LABEL[v.departureInspection] : "",
      outCount: v.damageOut.length,
      outNotes: noteList(v.damageOut),
    })),
    totals: true,
    note: "Each damage photo carries the note the inspector wrote with it. The photos are in the app (Cars, then In or Out).",
  };

  return {
    title: "Car Lot Damage Report",
    meta: baseMeta(ctx, yardOf(ctx), [["Period", periodLabel(period)], ["Cars", "Arrived or released in the period"]]),
    fileName: fileName("Car_Damage", [ctx.yardId], ctx),
    sheets: [
      { name: "Summary", kpis, tables: [] },
      { name: "Damage", tables: [detail], detail: true },
    ],
  };
}

// ── 5. Holds (any hold that touches the period) ─────────────────────────────

export function buildLotHoldsReport(visits: LotReportVisit[], holds: LotHold[], ctx: CarLotReportContext): ReportSpec {
  const { now, period } = ctx;
  const byId = new Map(visits.map((v) => [v.id, v]));
  const end = periodEnd(period, now);
  const shown = holds
    .filter((h) => byId.has(h.visitId))
    .filter((h) => (!h.start || h.start <= end) && (!h.end || !period.from || h.end >= period.from))
    .sort((a, b) => (a.start?.getTime() ?? 0) - (b.start?.getTime() ?? 0));
  const released = shown.filter((h) => h.start && h.end);

  const kpis: ReportKpi[] = [
    { label: "Holds in the period", value: shown.length, format: "int" },
    { label: "Still on hold", value: shown.filter((h) => !h.end).length, format: "int" },
    {
      label: "Average days on hold (released holds)",
      value: average1(released.map((h) => dwellDays(h.start as Date, h.end as Date))),
      format: "decimal1",
    },
  ];

  const detail: ReportTable = {
    columns: [
      { key: "#", header: "#", width: 6, format: "int", total: "label" },
      { key: "vin", header: "VIN", width: 21, total: "count" },
      { key: "manufacturer", header: "Manufacturer", width: 18 },
      { key: "ticket", header: "Ticket", width: 9, format: "int" },
      { key: "start", header: "On hold from", width: 18, format: "datetime" },
      { key: "startedBy", header: "Put on hold by", width: 18 },
      { key: "reason", header: "Reason", width: 36 },
      { key: "end", header: "Hold released", width: 18, format: "datetime" },
      { key: "endedBy", header: "Released by", width: 18 },
      { key: "days", header: "Days on hold", width: 13, format: "decimal1" },
    ],
    rows: shown.map((h, i) => {
      const v = byId.get(h.visitId) as LotReportVisit;
      return {
        ...numberRow(i + 1),
        vin: v.vin,
        manufacturer: v.manufacturerName,
        ticket: v.ticketNumber,
        start: h.start ?? `Before ${HISTORY_SINCE}`,
        startedBy: h.startedBy ?? "",
        reason: h.reason ?? "",
        end: h.end ?? "Still on hold",
        endedBy: h.endedBy ?? "",
        days: h.start ? dwellDays(h.start, h.end ?? now) : null,
      } satisfies Record<string, CellValue>;
    }),
    totals: true,
    note: `Holds are in the car's history from ${HISTORY_SINCE}. A hold still open counts its days up to now.`,
  };

  return {
    title: "Car Lot Holds Report",
    meta: baseMeta(ctx, yardOf(ctx), [["Period", periodLabel(period)]]),
    fileName: fileName("Car_Holds", [ctx.yardId], ctx),
    sheets: [
      { name: "Summary", kpis, tables: [] },
      { name: "Holds", tables: [detail], detail: true },
    ],
  };
}

export function buildLotReport(
  kind: LotReportKind, visits: LotReportVisit[], holds: LotHold[], ctx: CarLotReportContext,
): ReportSpec {
  switch (kind) {
    case "stock": return buildLotStockReport(visits, ctx);
    case "movements": return buildLotMovementsReport(visits, ctx);
    case "dwell": return buildLotDwellReport(visits, ctx);
    case "damage": return buildLotDamageReport(visits, ctx);
    case "holds": return buildLotHoldsReport(visits, holds, ctx);
  }
}
