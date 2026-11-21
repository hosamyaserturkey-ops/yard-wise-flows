/**
 * The car lot's numbers, for the Overview page and the Excel reports. Pure: no
 * React, no Supabase, and every function takes `now`, so each figure can be
 * tested. Days are counted the way the Cars list and the manufacturer portal
 * count them (`daysInLot`: the day a car arrives is day 1).
 */
import { daysInLot, daysOverFree, type VisitStatus } from "@/lib/carLot";
import { dayKey, lastNDayLabels } from "@/lib/dashboardStats";
import { normalizeBlock } from "@/lib/yardSlots";

/** An inspection of one phase of a visit: closed, started but open, or not started. */
export type InspectionState = "closed" | "open" | "missing";

/** One stay of a car in the lot, as the overview and the reports use it. */
export interface LotVisit {
  id: string;
  ticketNumber: number;
  status: VisitStatus;
  gateIn: Date;
  gateOut: Date | null;
  freeDays: number;
  zone: string | null;
  slot: string | null;
  vin: string;
  model: string | null;
  modelYear: number | null;
  color: string | null;
  manufacturerCode: string;
  manufacturerName: string;
  holdReason: string | null;
  heldAt: Date | null;
  arrivalInspection: InspectionState;
  departureInspection: InspectionState;
}

/** The state of a visit's inspection for one phase (a visit has at most one per phase). */
export function inspectionState(
  inspections: { phase: string; status: string }[] | null | undefined,
  phase: "gate_in" | "gate_out",
): InspectionState {
  const row = (inspections ?? []).find((i) => i.phase === phase);
  if (!row) return "missing";
  return row.status === "closed" ? "closed" : "open";
}

/** In the lot now: in the lot or on hold, not released. */
export const isInLot = (v: Pick<LotVisit, "status">): boolean => v.status !== "out";

/** Days in the lot so far, or in total once released. */
export const lotDays = (v: Pick<LotVisit, "gateIn" | "gateOut">, now: Date): number =>
  daysInLot(v.gateIn, now, v.gateOut);

/** Days beyond the car's free days (0 while still within them). */
export const overFreeDays = (v: Pick<LotVisit, "gateIn" | "gateOut" | "freeDays">, now: Date): number =>
  daysOverFree(lotDays(v, now), v.freeDays);

function todayBounds(now: Date): { start: Date; end: Date } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

export interface LotKpis {
  inLot: number;
  onHold: number;
  overFree: number;
  arrivedToday: number;
  releasedToday: number;
  /** Cars in the lot whose arrival inspection is not closed (open or not started). */
  arrivalNotClosed: number;
  /** Days in the lot of the car that has been there longest, or null when the lot is empty. */
  oldestDays: number | null;
}

/** The headline numbers. "Today" is the device's local day, as on the container dashboard. */
export function lotKpis(visits: LotVisit[], now: Date): LotKpis {
  const { start, end } = todayBounds(now);
  const today = (d: Date | null) => !!d && d >= start && d < end;
  const open = visits.filter(isInLot);
  const days = open.map((v) => lotDays(v, now));
  return {
    inLot: open.length,
    onHold: open.filter((v) => v.status === "on-hold").length,
    overFree: open.filter((v) => overFreeDays(v, now) > 0).length,
    arrivedToday: visits.filter((v) => today(v.gateIn)).length,
    releasedToday: visits.filter((v) => today(v.gateOut)).length,
    arrivalNotClosed: open.filter((v) => v.arrivalInspection !== "closed").length,
    oldestDays: days.length ? Math.max(...days) : null,
  };
}

/**
 * Age bands for the cars in the lot. The first band roughly matches the usual
 * 7 free days; the lot keeps cars for months, so the bands reach past 90 days.
 */
export const LOT_AGE_BANDS = [
  { key: "week", label: "1–7 days", maxDays: 7 },
  { key: "twoWeeks", label: "8–14 days", maxDays: 14 },
  { key: "month", label: "15–30 days", maxDays: 30 },
  { key: "quarter", label: "31–90 days", maxDays: 90 },
  { key: "long", label: "Over 90 days", maxDays: Infinity },
] as const;

export type LotAgeBandKey = (typeof LOT_AGE_BANDS)[number]["key"];

/** The band a car falls into by its days in the lot (day 1 = arrival day). */
export function ageBandOf(days: number): LotAgeBandKey {
  return (LOT_AGE_BANDS.find((b) => days <= b.maxDays) ?? LOT_AGE_BANDS[LOT_AGE_BANDS.length - 1]).key;
}

export function ageBands(visits: LotVisit[], now: Date): { key: LotAgeBandKey; label: string; count: number }[] {
  const counts = new Map<LotAgeBandKey, number>();
  for (const v of visits) {
    if (!isInLot(v)) continue;
    const key = ageBandOf(lotDays(v, now));
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return LOT_AGE_BANDS.map((b) => ({ key: b.key, label: b.label, count: counts.get(b.key) ?? 0 }));
}

export interface ManufacturerStock {
  code: string;
  name: string;
  inLot: number;
  onHold: number;
  overFree: number;
  /** Average days in the lot, to one decimal. */
  avgDays: number;
  oldestDays: number;
}

/** The cars in the lot per manufacturer, the largest stock first. */
export function stockByManufacturer(visits: LotVisit[], now: Date): ManufacturerStock[] {
  const groups = new Map<string, { code: string; name: string; days: number[]; onHold: number; overFree: number }>();
  for (const v of visits) {
    if (!isInLot(v)) continue;
    const key = v.manufacturerCode || v.manufacturerName;
    const g = groups.get(key) ?? { code: v.manufacturerCode, name: v.manufacturerName, days: [], onHold: 0, overFree: 0 };
    g.days.push(lotDays(v, now));
    if (v.status === "on-hold") g.onHold += 1;
    if (overFreeDays(v, now) > 0) g.overFree += 1;
    groups.set(key, g);
  }
  return [...groups.values()]
    .map((g) => ({
      code: g.code,
      name: g.name,
      inLot: g.days.length,
      onHold: g.onHold,
      overFree: g.overFree,
      avgDays: Math.round((g.days.reduce((a, b) => a + b, 0) / g.days.length) * 10) / 10,
      oldestDays: Math.max(...g.days),
    }))
    .sort((a, b) => b.inLot - a.inLot || a.name.localeCompare(b.name));
}

/** The label used for cars registered without a zone. */
export const NO_SPOT = "No spot";

/**
 * The cars in the lot per zone. Zones are typed by hand, so " b " and "B" are
 * one zone (the same normalising as the container yard map). Natural order, so
 * "Z2" comes before "Z10"; cars without a zone come last.
 */
export function stockByZone(visits: LotVisit[]): { zone: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const v of visits) {
    if (!isInLot(v)) continue;
    const zone = v.zone?.trim() ? normalizeBlock(v.zone) : NO_SPOT;
    counts.set(zone, (counts.get(zone) ?? 0) + 1);
  }
  return [...counts]
    .map(([zone, count]) => ({ zone, count }))
    .sort((a, b) =>
      Number(a.zone === NO_SPOT) - Number(b.zone === NO_SPOT) ||
      a.zone.localeCompare(b.zone, undefined, { numeric: true }));
}

export interface LotTrendPoint {
  /** Axis label, e.g. "21 Nov". */
  label: string;
  /** `yyyy-mm-dd` of the day. */
  dayKey: string;
  arrivals: number;
  releases: number;
}

/** Arrivals and releases per local day for the last `days` days, oldest first, ending today. */
export function dailyMovements(visits: LotVisit[], days: number, now: Date): LotTrendPoint[] {
  return lastNDayLabels(days, now).map(({ date, label }) => {
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    const inDay = (d: Date | null) => !!d && d >= date && d < next;
    return {
      label,
      dayKey: dayKey(date),
      arrivals: visits.filter((v) => inDay(v.gateIn)).length,
      releases: visits.filter((v) => inDay(v.gateOut)).length,
    };
  });
}

/** Cars in the lot whose arrival inspection is not closed, the longest waiting first. */
export function awaitingArrivalInspection(visits: LotVisit[]): LotVisit[] {
  return visits
    .filter((v) => isInLot(v) && v.arrivalInspection !== "closed")
    .sort((a, b) => a.gateIn.getTime() - b.gateIn.getTime());
}

/** Cars on hold, the longest held first. */
export function carsOnHold(visits: LotVisit[]): LotVisit[] {
  return visits
    .filter((v) => v.status === "on-hold")
    .sort((a, b) => (a.heldAt ?? a.gateIn).getTime() - (b.heldAt ?? b.gateIn).getTime());
}

/** The cars in the lot furthest past their free days. */
export function mostOverFree(visits: LotVisit[], now: Date, limit = 10): { visit: LotVisit; days: number; over: number }[] {
  return visits
    .filter(isInLot)
    .map((visit) => ({ visit, days: lotDays(visit, now), over: overFreeDays(visit, now) }))
    .filter((r) => r.over > 0)
    .sort((a, b) => b.over - a.over || a.visit.gateIn.getTime() - b.visit.gateIn.getTime())
    .slice(0, limit);
}
