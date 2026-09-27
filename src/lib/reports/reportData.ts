// Pure builders for the four Excel reports — no React, no Supabase, no ExcelJS.
// Each takes plain rows plus a context and returns a ReportSpec that
// workbook.ts renders. Every function takes `now` through the context so the
// numbers are reproducible in tests.

import {
  AGING_BUCKETS,
  SIZE_BUCKET_LABELS,
  agingBucketOf,
  daysInYard,
  dayKey,
  sizeBucketOf,
  type SizeBucket,
} from "@/lib/dashboardStats";
import { shippingLineOwed, yardEarned } from "@/lib/accounting";
import { shiftForDate } from "@/lib/shifts";
import type {
  CellValue,
  ReportColumn,
  ReportKpi,
  ReportSheet,
  ReportSpec,
  ReportTable,
} from "./reportModel";

export type ReportKind = "in-yard" | "movements" | "fees" | "drivers";

/** One container visit, as the reports need it. */
export interface ReportVisit {
  id: string;
  yardId: string;
  ticketNumber: number;
  containerNumber: string;
  containerType: string;
  shippingLine: string;
  /** Driver and truck that delivered the container at gate-in. */
  driverName: string;
  truckNumber: string;
  /** Driver and truck that collected it at gate-out. */
  gateOutDriverName?: string;
  gateOutTruckNumber?: string;
  gateInTime: Date;
  gateOutTime?: Date;
  status: "in-yard" | "out" | "reserved";
  bookingNumber?: string;
  sealNumber?: string;
  fees?: number;
  yardBlock?: string;
  yardRow?: string;
  portArrivalDate?: string;
  /** Operator who gated the container in. */
  receivedBy?: string;
  /** Operator who gated the container out. */
  releasedBy?: string;
}

/** One demurrage collection. */
export interface ReportPayment {
  createdAt: Date;
  yardId: string;
  containerNumber: string;
  shippingLine: string;
  chargeableDays: number;
  demurrageAmount: number;
  serviceFee: number;
  totalCollected: number;
  paymentMethod: string;
  transferred: boolean;
  collectedBy?: string;
}

export interface ReportContext {
  now: Date;
  /** Inclusive local-day bounds; either may be open. */
  period: { from?: Date; to?: Date };
  /** yard id → display name, used for the header and the Yard column. */
  yardNames: Record<string, string>;
  /** yard id → short code (e.g. "EVL"), used in the file name. */
  yardCodes: Record<string, string>;
  /** Human-readable summary of the filters applied on the Reports page. */
  filtersLabel: string;
  generatedBy?: string;
}

// ── helpers ─────────────────────────────────────────────────────────────────

/** Twenty-foot equivalent units: 20ft = 1, 40ft and 45ft = 2. */
export function teuOf(containerType: string): number {
  const t = (containerType || "").trim().toUpperCase();
  if (t.startsWith("20")) return 1;
  if (t.startsWith("40") || t.startsWith("45")) return 2;
  return 0;
}

const STATUS_LABEL: Record<ReportVisit["status"], string> = {
  "in-yard": "In Yard",
  reserved: "Reserved",
  out: "Gated Out",
};

const agingLabel = (gateIn: Date, now: Date) =>
  AGING_BUCKETS.find((b) => b.key === agingBucketOf(gateIn, now))!.label;

/** Fractional days between two instants, to one decimal. */
export function dwellDays(from: Date, to: Date): number {
  return Math.round(((to.getTime() - from.getTime()) / 86_400_000) * 10) / 10;
}

const byLineThenCount = <T extends { line: string }>(rows: T[], count: (r: T) => number) =>
  rows.sort((a, b) => count(b) - count(a) || a.line.localeCompare(b.line));

function inPeriod(d: Date | undefined, period: ReportContext["period"]): d is Date {
  if (!d) return false;
  if (period.from && d < period.from) return false;
  if (period.to && d > period.to) return false;
  return true;
}

const fmtDay = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });

const fmtStamp = (d: Date) =>
  `${fmtDay(d)} ${d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;

export function periodLabel(period: ReportContext["period"]): string {
  if (period.from && period.to) return `${fmtDay(period.from)} – ${fmtDay(period.to)}`;
  if (period.from) return `From ${fmtDay(period.from)}`;
  if (period.to) return `Up to ${fmtDay(period.to)}`;
  return "All dates";
}

function yardIds(visits: { yardId: string }[]): string[] {
  return Array.from(new Set(visits.map((v) => v.yardId)));
}

function yardLabel(ids: string[], ctx: ReportContext): string {
  if (ids.length === 1) return ctx.yardNames[ids[0]] ?? "—";
  if (ids.length === 0) {
    const known = Object.values(ctx.yardNames);
    return known.length === 1 ? known[0] : "—";
  }
  return `All yards (${ids.length})`;
}

function fileName(kind: string, ids: string[], ctx: ReportContext): string {
  const known = Object.values(ctx.yardCodes);
  const single = ids.length === 1 ? ctx.yardCodes[ids[0]] : ids.length === 0 && known.length === 1 ? known[0] : undefined;
  const code = ids.length > 1 ? "ALL" : (single || "Yard").toUpperCase();
  return `${code}_${kind}_${dayKey(ctx.now)}.xlsx`;
}

function baseMeta(ctx: ReportContext, yard: string, extra: [string, string][]): [string, string][] {
  const meta: [string, string][] = [["Yard", yard], ...extra];
  meta.push(["Filters", ctx.filtersLabel || "None"]);
  meta.push(["Generated", fmtStamp(ctx.now) + (ctx.generatedBy ? ` by ${ctx.generatedBy}` : "")]);
  return meta;
}

/** A "Yard" column, added only when a report spans more than one yard. */
function yardColumn(multiYard: boolean): ReportColumn[] {
  return multiYard ? [{ key: "yard", header: "Yard", width: 18 }] : [];
}

const numberRow = (n: number) => ({ "#": n });

// ── 1. In-Yard Stock ────────────────────────────────────────────────────────

const SIZE_ORDER: SizeBucket[] = ["small", "large", "hc", "reefer"];

export function buildInYardReport(visits: ReportVisit[], ctx: ReportContext): ReportSpec {
  const onSite = visits
    .filter((v) => v.status === "in-yard" || v.status === "reserved")
    .sort((a, b) => a.gateInTime.getTime() - b.gateInTime.getTime());
  const { now } = ctx;
  const ids = yardIds(onSite);
  const multiYard = ids.length > 1;

  const days = onSite.map((v) => daysInYard(v.gateInTime, now));
  const teu = onSite.reduce((s, v) => s + teuOf(v.containerType), 0);
  const reserved = onSite.filter((v) => v.status === "reserved").length;
  const over21 = days.filter((d) => d > 21).length;

  const kpis: ReportKpi[] = [
    { label: "Containers on site", value: onSite.length, format: "int" },
    { label: "Available (in yard)", value: onSite.length - reserved, format: "int" },
    { label: "Reserved", value: reserved, format: "int" },
    { label: "TEU on site", value: teu, format: "int" },
    {
      label: "Average days on site",
      value: days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : 0,
      format: "decimal1",
    },
    { label: "Longest stay (days)", value: days.length ? Math.max(...days) : 0, format: "int" },
    { label: "On site over 21 days", value: over21, format: "int" },
  ];

  // Stock by line × size
  const lines = Array.from(new Set(onSite.map((v) => v.shippingLine)));
  const stock = lines.map((line) => {
    const mine = onSite.filter((v) => v.shippingLine === line);
    const row: Record<string, CellValue> & { line: string } = { line };
    for (const b of SIZE_ORDER) row[b] = mine.filter((v) => sizeBucketOf(v.containerType) === b).length;
    row.reserved = mine.filter((v) => v.status === "reserved").length;
    row.total = mine.length;
    row.teu = mine.reduce((s, v) => s + teuOf(v.containerType), 0);
    return row;
  });
  byLineThenCount(stock, (r) => r.total as number);

  const stockTable: ReportTable = {
    title: "Stock by shipping line",
    columns: [
      { key: "line", header: "Shipping Line", width: 18, total: "label" },
      ...SIZE_ORDER.map((b) => ({ key: b, header: SIZE_BUCKET_LABELS[b], width: 11, format: "int" as const, total: "sum" as const })),
      { key: "reserved", header: "Reserved", width: 11, format: "int", total: "sum" },
      { key: "total", header: "Total", width: 11, format: "int", total: "sum" },
      { key: "teu", header: "TEU", width: 11, format: "int", total: "sum" },
    ],
    rows: stock,
    totals: true,
  };

  // Aging by line
  const aging = lines.map((line) => {
    const mine = onSite.filter((v) => v.shippingLine === line);
    const row: Record<string, CellValue> & { line: string } = { line };
    for (const b of AGING_BUCKETS) row[b.key] = mine.filter((v) => agingBucketOf(v.gateInTime, now) === b.key).length;
    row.total = mine.length;
    row.oldest = Math.max(...mine.map((v) => daysInYard(v.gateInTime, now)));
    return row;
  });
  byLineThenCount(aging, (r) => r.total as number);

  const agingTable: ReportTable = {
    title: "Time on site by shipping line",
    columns: [
      { key: "line", header: "Shipping Line", width: 18, total: "label" },
      ...AGING_BUCKETS.map((b) => ({ key: b.key, header: b.label, width: 11, format: "int" as const, total: "sum" as const })),
      { key: "total", header: "Total", width: 11, format: "int", total: "sum" },
      { key: "oldest", header: "Longest (days)", width: 14, format: "int" },
    ],
    rows: aging,
    totals: true,
    note: "Days on site are whole days since gate-in, the same bands the dashboard uses.",
  };

  // By container type
  const types = Array.from(new Set(onSite.map((v) => v.containerType))).sort();
  const typeTable: ReportTable = {
    title: "Stock by container type",
    columns: [
      { key: "type", header: "Type", width: 18, total: "label" },
      { key: "count", header: "Containers", width: 11, format: "int", total: "sum" },
      { key: "teu", header: "TEU", width: 11, format: "int", total: "sum" },
    ],
    rows: types.map((type) => {
      const n = onSite.filter((v) => v.containerType === type).length;
      return { type, count: n, teu: n * teuOf(type) };
    }),
    totals: true,
  };

  const detail: ReportTable = {
    columns: [
      { key: "#", header: "#", width: 6, format: "int", total: "label" },
      ...yardColumn(multiYard),
      { key: "ticket", header: "Ticket", width: 9, format: "int" },
      { key: "container", header: "Container No.", width: 16, total: "count" },
      { key: "type", header: "Type", width: 8 },
      { key: "teu", header: "TEU", width: 6, format: "int", total: "sum" },
      { key: "line", header: "Shipping Line", width: 14 },
      { key: "status", header: "Status", width: 11 },
      { key: "gateIn", header: "Gate In", width: 18, format: "datetime" },
      { key: "days", header: "Days on Site", width: 12, format: "int", total: "average" },
      { key: "band", header: "Age Band", width: 12 },
      { key: "block", header: "Block", width: 8 },
      { key: "row", header: "Row", width: 7 },
      { key: "booking", header: "Reserved For", width: 16 },
      { key: "driver", header: "Gate-In Driver", width: 18 },
      { key: "truck", header: "Gate-In Truck", width: 13 },
      { key: "receivedBy", header: "Received By", width: 18 },
    ],
    rows: onSite.map((v, i) => ({
      ...numberRow(i + 1),
      yard: ctx.yardNames[v.yardId] ?? "—",
      ticket: v.ticketNumber,
      container: v.containerNumber,
      type: v.containerType,
      teu: teuOf(v.containerType),
      line: v.shippingLine,
      status: STATUS_LABEL[v.status],
      gateIn: v.gateInTime,
      days: daysInYard(v.gateInTime, now),
      band: agingLabel(v.gateInTime, now),
      block: v.yardBlock ?? "",
      row: v.yardRow ?? "",
      booking: v.status === "reserved" ? v.bookingNumber ?? "" : "",
      driver: v.driverName,
      truck: v.truckNumber,
      receivedBy: v.receivedBy ?? "",
    })),
    totals: true,
    ageColumnKey: "days",
    note: "Oldest first. Days on Site: amber over 14, orange over 21, red over 30.",
  };

  return {
    title: "In-Yard Stock Report",
    meta: baseMeta(ctx, yardLabel(ids, ctx), [["Snapshot", fmtStamp(now)]]),
    fileName: fileName("In-Yard_Report", ids, ctx),
    sheets: [
      { name: "Summary", kpis, tables: [stockTable, agingTable, typeTable] },
      { name: "In-Yard Containers", tables: [detail], detail: true },
    ],
  };
}

// ── 2. Gate Movements ───────────────────────────────────────────────────────

interface Move {
  at: Date;
  direction: "IN" | "OUT";
  visit: ReportVisit;
}

/** Every gate-in and gate-out inside the period, oldest first. */
export function gateMoves(visits: ReportVisit[], period: ReportContext["period"]): Move[] {
  const moves: Move[] = [];
  for (const v of visits) {
    if (inPeriod(v.gateInTime, period)) moves.push({ at: v.gateInTime, direction: "IN", visit: v });
    if (inPeriod(v.gateOutTime, period)) moves.push({ at: v.gateOutTime, direction: "OUT", visit: v });
  }
  return moves.sort((a, b) => a.at.getTime() - b.at.getTime());
}

/**
 * The driver and truck for a move: gate-in's own for an IN, gate-out's own for
 * an OUT. A visit read before the gate-out columns existed carries the
 * collecting driver on the gate-in fields, hence the fallback.
 */
export function moveCarrier(m: Move): { driver: string | null; truck: string | null } {
  const v = m.visit;
  if (m.direction === "IN") return { driver: v.driverName || null, truck: v.truckNumber || null };
  return {
    driver: v.gateOutDriverName || v.driverName || null,
    truck: v.gateOutTruckNumber || v.truckNumber || null,
  };
}

export function buildMovementsReport(visits: ReportVisit[], ctx: ReportContext): ReportSpec {
  const moves = gateMoves(visits, ctx.period);
  const ids = yardIds(moves.map((m) => m.visit));
  const multiYard = ids.length > 1;
  const ins = moves.filter((m) => m.direction === "IN");
  const outs = moves.filter((m) => m.direction === "OUT");
  const teu = (ms: Move[]) => ms.reduce((s, m) => s + teuOf(m.visit.containerType), 0);
  const dwell = outs.map((m) => dwellDays(m.visit.gateInTime, m.at));
  const avgDwell = dwell.length ? Math.round((dwell.reduce((a, b) => a + b, 0) / dwell.length) * 10) / 10 : 0;

  const kpis: ReportKpi[] = [
    { label: "Gate-ins", value: ins.length, format: "int" },
    { label: "Gate-outs", value: outs.length, format: "int" },
    { label: "Net change", value: ins.length - outs.length, format: "int" },
    { label: "TEU in", value: teu(ins), format: "int" },
    { label: "TEU out", value: teu(outs), format: "int" },
    { label: "Average dwell of gated-out (days)", value: avgDwell, format: "decimal1" },
  ];

  // Daily totals — every day in the range, including quiet ones.
  const dailyRows: Record<string, CellValue>[] = [];
  if (moves.length) {
    const first = ctx.period.from ?? moves[0].at;
    // A range runs to its end day, but never past today; an open range stops at the last move.
    const last = ctx.period.to
      ? (ctx.period.to < ctx.now ? ctx.period.to : ctx.now)
      : moves[moves.length - 1].at;
    const day = new Date(first.getFullYear(), first.getMonth(), first.getDate());
    while (day <= last) {
      const k = dayKey(day);
      const dIn = ins.filter((m) => dayKey(m.at) === k);
      const dOut = outs.filter((m) => dayKey(m.at) === k);
      dailyRows.push({
        date: new Date(day),
        in: dIn.length,
        out: dOut.length,
        net: dIn.length - dOut.length,
        teuIn: teu(dIn),
        teuOut: teu(dOut),
      });
      day.setDate(day.getDate() + 1);
    }
  }

  const daily: ReportTable = {
    title: "Daily movements",
    columns: [
      { key: "date", header: "Date", width: 18, format: "date", total: "label" },
      { key: "in", header: "Gate-ins", width: 11, format: "int", total: "sum" },
      { key: "out", header: "Gate-outs", width: 11, format: "int", total: "sum" },
      { key: "net", header: "Net", width: 11, format: "int", total: "sum" },
      { key: "teuIn", header: "TEU In", width: 11, format: "int", total: "sum" },
      { key: "teuOut", header: "TEU Out", width: 11, format: "int", total: "sum" },
    ],
    rows: dailyRows,
    totals: true,
  };

  const lines = Array.from(new Set(moves.map((m) => m.visit.shippingLine)));
  const byLineRows = lines.map((line) => {
    const lIn = ins.filter((m) => m.visit.shippingLine === line).length;
    const lOutMoves = outs.filter((m) => m.visit.shippingLine === line);
    const lDwell = lOutMoves.map((m) => dwellDays(m.visit.gateInTime, m.at));
    return {
      line,
      in: lIn,
      out: lOutMoves.length,
      net: lIn - lOutMoves.length,
      dwell: lDwell.length ? Math.round((lDwell.reduce((a, b) => a + b, 0) / lDwell.length) * 10) / 10 : null,
    };
  });
  byLineThenCount(byLineRows, (r) => r.in + r.out);

  const byLine: ReportTable = {
    title: "By shipping line",
    columns: [
      { key: "line", header: "Shipping Line", width: 18, total: "label" },
      { key: "in", header: "Gate-ins", width: 11, format: "int", total: "sum" },
      { key: "out", header: "Gate-outs", width: 11, format: "int", total: "sum" },
      { key: "net", header: "Net", width: 11, format: "int", total: "sum" },
      { key: "dwell", header: "Avg Dwell Out (days)", width: 19, format: "decimal1" },
    ],
    rows: byLineRows,
    totals: true,
  };

  const shiftRows = (["day", "night"] as const).map((shift) => ({
    shift: shift === "day" ? "Day (06:00–18:00)" : "Night (18:00–06:00)",
    in: ins.filter((m) => shiftForDate(m.at) === shift).length,
    out: outs.filter((m) => shiftForDate(m.at) === shift).length,
  }));
  const byShift: ReportTable = {
    title: "By shift",
    columns: [
      { key: "shift", header: "Shift", width: 18, total: "label" },
      { key: "in", header: "Gate-ins", width: 11, format: "int", total: "sum" },
      { key: "out", header: "Gate-outs", width: 11, format: "int", total: "sum" },
    ],
    rows: shiftRows,
    totals: true,
  };

  const detail: ReportTable = {
    columns: [
      { key: "#", header: "#", width: 6, format: "int", total: "label" },
      ...yardColumn(multiYard),
      { key: "at", header: "Date / Time", width: 18, format: "datetime" },
      { key: "move", header: "Move", width: 7 },
      { key: "shift", header: "Shift", width: 7 },
      { key: "ticket", header: "Ticket", width: 9, format: "int" },
      { key: "container", header: "Container No.", width: 16, total: "count" },
      { key: "type", header: "Type", width: 8 },
      { key: "teu", header: "TEU", width: 6, format: "int", total: "sum" },
      { key: "line", header: "Shipping Line", width: 14 },
      { key: "driver", header: "Driver", width: 18 },
      { key: "truck", header: "Truck No.", width: 11 },
      { key: "booking", header: "Booking", width: 16 },
      { key: "seal", header: "Seal", width: 14 },
      { key: "operator", header: "Operator", width: 18 },
      { key: "dwell", header: "Dwell (days)", width: 12, format: "decimal1", total: "average" },
    ],
    rows: moves.map((m, i) => {
      const v = m.visit;
      const { driver, truck } = moveCarrier(m);
      return {
        ...numberRow(i + 1),
        yard: ctx.yardNames[v.yardId] ?? "—",
        at: m.at,
        move: m.direction,
        shift: shiftForDate(m.at) === "day" ? "Day" : "Night",
        ticket: v.ticketNumber,
        container: v.containerNumber,
        type: v.containerType,
        teu: teuOf(v.containerType),
        line: v.shippingLine,
        driver: driver ?? "",
        truck: truck ?? "",
        booking: m.direction === "OUT" ? v.bookingNumber ?? "" : "",
        seal: m.direction === "OUT" ? v.sealNumber ?? "" : "",
        operator: (m.direction === "IN" ? v.receivedBy : v.releasedBy) ?? "",
        dwell: m.direction === "OUT" ? dwellDays(v.gateInTime, m.at) : null,
      };
    }),
    totals: true,
  };

  return {
    title: "Gate Movements Report",
    meta: baseMeta(ctx, yardLabel(ids, ctx), [["Period", periodLabel(ctx.period)]]),
    fileName: fileName("Gate_Movements", ids, ctx),
    sheets: [
      { name: "Summary", kpis, tables: [daily, byLine, byShift] },
      { name: "Movements", tables: [detail], detail: true },
    ],
  };
}

// ── 3. Fees & Demurrage ─────────────────────────────────────────────────────

const round3 = (n: number) => Math.round(n * 1000) / 1000;

export function buildFeesReport(
  visits: ReportVisit[],
  payments: ReportPayment[],
  ctx: ReportContext,
): ReportSpec {
  const pays = payments
    .filter((p) => inPeriod(p.createdAt, ctx.period))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const gateOuts = visits
    .filter((v) => inPeriod(v.gateOutTime, ctx.period))
    .sort((a, b) => a.gateOutTime!.getTime() - b.gateOutTime!.getTime());
  const ids = Array.from(new Set([...yardIds(pays), ...yardIds(gateOuts)]));
  const multiYard = ids.length > 1;

  // Accounting rule (see accounting.ts): demurrage is owed onward to the line,
  // the service fee is the yard's revenue. The stored share columns predate
  // that rule and are deliberately not used.
  const owed = (p: ReportPayment) =>
    shippingLineOwed({ shipping_line: p.shippingLine, demurrage_amount: p.demurrageAmount, service_fee: p.serviceFee, total_collected: p.totalCollected, transferred: p.transferred });
  const earned = (p: ReportPayment) =>
    yardEarned({ shipping_line: p.shippingLine, demurrage_amount: p.demurrageAmount, service_fee: p.serviceFee, total_collected: p.totalCollected, transferred: p.transferred });

  const sum = (xs: number[]) => round3(xs.reduce((a, b) => a + b, 0));
  const totalCollected = sum(pays.map((p) => p.totalCollected));
  const demurrage = sum(pays.map(owed));
  const service = sum(pays.map(earned));
  const pending = sum(pays.filter((p) => !p.transferred).map(owed));
  const gateOutFees = sum(gateOuts.map((v) => v.fees ?? 0));

  const kpis: ReportKpi[] = [
    { label: "Collected at the counter (JOD)", value: totalCollected, format: "money" },
    { label: "Demurrage owed to lines (JOD)", value: demurrage, format: "money" },
    { label: "Yard service fees (JOD)", value: service, format: "money" },
    { label: "Demurrage not yet transferred (JOD)", value: pending, format: "money" },
    { label: "Gate-out fees (JOD)", value: gateOutFees, format: "money" },
    { label: "Demurrage payments", value: pays.length, format: "int" },
  ];

  const lines = Array.from(new Set([...pays.map((p) => p.shippingLine), ...gateOuts.map((v) => v.shippingLine)]));
  const lineRows = lines.map((line) => {
    const lp = pays.filter((p) => p.shippingLine === line);
    return {
      line,
      payments: lp.length,
      days: lp.reduce((s, p) => s + p.chargeableDays, 0),
      demurrage: sum(lp.map(owed)),
      service: sum(lp.map(earned)),
      total: sum(lp.map((p) => p.totalCollected)),
      pending: sum(lp.filter((p) => !p.transferred).map(owed)),
      gateOutFees: sum(gateOuts.filter((v) => v.shippingLine === line).map((v) => v.fees ?? 0)),
    };
  });
  byLineThenCount(lineRows, (r) => r.total + r.gateOutFees);

  const byLine: ReportTable = {
    title: "By shipping line",
    columns: [
      { key: "line", header: "Shipping Line", width: 18, total: "label" },
      { key: "payments", header: "Payments", width: 11, format: "int", total: "sum" },
      { key: "days", header: "Chargeable Days", width: 15, format: "int", total: "sum" },
      { key: "demurrage", header: "Demurrage (JOD)", width: 16, format: "money", total: "sum" },
      { key: "service", header: "Service Fees (JOD)", width: 17, format: "money", total: "sum" },
      { key: "total", header: "Collected (JOD)", width: 16, format: "money", total: "sum" },
      { key: "pending", header: "Not Transferred (JOD)", width: 20, format: "money", total: "sum" },
      { key: "gateOutFees", header: "Gate-Out Fees (JOD)", width: 19, format: "money", total: "sum" },
    ],
    rows: lineRows,
    totals: true,
    note: "Demurrage is collected on the line's behalf and owed onward; the service fee is the yard's revenue.",
  };

  const methods = Array.from(new Set(pays.map((p) => p.paymentMethod || "—"))).sort();
  const byMethod: ReportTable = {
    title: "By payment method",
    columns: [
      { key: "method", header: "Method", width: 18, total: "label" },
      { key: "payments", header: "Payments", width: 11, format: "int", total: "sum" },
      { key: "total", header: "Collected (JOD)", width: 16, format: "money", total: "sum" },
    ],
    rows: methods.map((method) => {
      const mp = pays.filter((p) => (p.paymentMethod || "—") === method);
      return { method, payments: mp.length, total: sum(mp.map((p) => p.totalCollected)) };
    }),
    totals: true,
  };

  const paymentsSheet: ReportTable = {
    columns: [
      { key: "#", header: "#", width: 6, format: "int", total: "label" },
      ...yardColumn(multiYard),
      { key: "at", header: "Collected", width: 18, format: "datetime" },
      { key: "container", header: "Container No.", width: 16, total: "count" },
      { key: "line", header: "Shipping Line", width: 14 },
      { key: "days", header: "Chargeable Days", width: 15, format: "int", total: "sum" },
      { key: "demurrage", header: "Demurrage (JOD)", width: 16, format: "money", total: "sum" },
      { key: "service", header: "Service Fee (JOD)", width: 16, format: "money", total: "sum" },
      { key: "total", header: "Collected (JOD)", width: 16, format: "money", total: "sum" },
      { key: "method", header: "Method", width: 12 },
      { key: "transferred", header: "Transferred", width: 12 },
      { key: "by", header: "Collected By", width: 18 },
    ],
    rows: pays.map((p, i) => ({
      ...numberRow(i + 1),
      yard: ctx.yardNames[p.yardId] ?? "—",
      at: p.createdAt,
      container: p.containerNumber,
      line: p.shippingLine,
      days: p.chargeableDays,
      demurrage: owed(p),
      service: earned(p),
      total: p.totalCollected,
      method: p.paymentMethod || "—",
      transferred: p.transferred ? "Yes" : "No",
      by: p.collectedBy ?? "",
    })),
    totals: true,
  };

  const feesSheet: ReportTable = {
    columns: [
      { key: "#", header: "#", width: 6, format: "int", total: "label" },
      ...yardColumn(multiYard),
      { key: "at", header: "Gate Out", width: 18, format: "datetime" },
      { key: "ticket", header: "Ticket", width: 9, format: "int" },
      { key: "container", header: "Container No.", width: 16, total: "count" },
      { key: "type", header: "Type", width: 8 },
      { key: "line", header: "Shipping Line", width: 14 },
      { key: "booking", header: "Booking", width: 16 },
      { key: "fees", header: "Fees (JOD)", width: 12, format: "money", total: "sum" },
      { key: "by", header: "Released By", width: 18 },
    ],
    rows: gateOuts.map((v, i) => ({
      ...numberRow(i + 1),
      yard: ctx.yardNames[v.yardId] ?? "—",
      at: v.gateOutTime!,
      ticket: v.ticketNumber,
      container: v.containerNumber,
      type: v.containerType,
      line: v.shippingLine,
      booking: v.bookingNumber ?? "",
      fees: v.fees ?? 0,
      by: v.releasedBy ?? "",
    })),
    totals: true,
  };

  return {
    title: "Fees & Demurrage Report",
    meta: baseMeta(ctx, yardLabel(ids, ctx), [["Period", periodLabel(ctx.period)]]),
    fileName: fileName("Fees_Demurrage", ids, ctx),
    sheets: [
      { name: "Summary", kpis, tables: [byLine, byMethod] },
      { name: "Demurrage Payments", tables: [paymentsSheet], detail: true },
      { name: "Gate-Out Fees", tables: [feesSheet], detail: true },
    ],
  };
}

// ── 4. Driver & Truck Activity ──────────────────────────────────────────────

/** Folds spacing and case so "Mohamad " and "MOHAMAD" count as one driver. */
export const normalizeName = (s: string) => s.trim().replace(/\s+/g, " ").toUpperCase();

export function buildDriversReport(visits: ReportVisit[], ctx: ReportContext): ReportSpec {
  const moves = gateMoves(visits, ctx.period);
  const ids = yardIds(moves.map((m) => m.visit));
  const attributed = moves
    .map((m) => ({ m, ...moveCarrier(m) }))
    .filter((x) => x.driver || x.truck);
  const unattributed = moves.length - attributed.length;

  type Agg = { ins: number; outs: number; teu: number; first: Date; last: Date; peers: Set<string>; lines: Set<string> };
  const aggregate = (keyOf: (x: (typeof attributed)[number]) => string | null, peerOf: (x: (typeof attributed)[number]) => string | null) => {
    const map = new Map<string, Agg>();
    for (const x of attributed) {
      const key = keyOf(x);
      if (!key) continue;
      const a = map.get(key) ?? { ins: 0, outs: 0, teu: 0, first: x.m.at, last: x.m.at, peers: new Set(), lines: new Set() };
      if (x.m.direction === "IN") a.ins += 1;
      else a.outs += 1;
      a.teu += teuOf(x.m.visit.containerType);
      if (x.m.at < a.first) a.first = x.m.at;
      if (x.m.at > a.last) a.last = x.m.at;
      const peer = peerOf(x);
      if (peer) a.peers.add(peer);
      a.lines.add(x.m.visit.shippingLine);
      map.set(key, a);
    }
    return Array.from(map.entries())
      .map(([key, a]) => ({ key, ...a, total: a.ins + a.outs }))
      .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key));
  };

  const drivers = aggregate(
    (x) => (x.driver ? normalizeName(x.driver) : null),
    (x) => x.truck?.trim() || null,
  );
  const trucks = aggregate(
    (x) => x.truck?.trim() || null,
    (x) => (x.driver ? normalizeName(x.driver) : null),
  );

  const kpis: ReportKpi[] = [
    { label: "Active drivers", value: drivers.length, format: "int" },
    { label: "Active trucks", value: trucks.length, format: "int" },
    { label: "Moves with a known driver", value: attributed.length, format: "int" },
    {
      label: "Average moves per driver",
      value: drivers.length ? Math.round((attributed.length / drivers.length) * 10) / 10 : 0,
      format: "decimal1",
    },
    ...(unattributed > 0 ? [{ label: "Moves with no driver on record", value: unattributed, format: "int" as const }] : []),
  ];

  const list = (s: Set<string>) => Array.from(s).sort().join(", ");

  const driverTable = (rows: typeof drivers, title?: string): ReportTable => ({
    title,
    columns: [
      { key: "#", header: "#", width: 6, format: "int", total: "label" },
      { key: "name", header: "Driver", width: 22, total: "count" },
      { key: "ins", header: "Gate-ins", width: 10, format: "int", total: "sum" },
      { key: "outs", header: "Gate-outs", width: 10, format: "int", total: "sum" },
      { key: "total", header: "Total Moves", width: 12, format: "int", total: "sum" },
      { key: "teu", header: "TEU Moved", width: 11, format: "int", total: "sum" },
      { key: "peers", header: "Trucks Used", width: 26 },
      { key: "lines", header: "Lines", width: 16 },
      { key: "first", header: "First Move", width: 18, format: "datetime" },
      { key: "last", header: "Last Move", width: 18, format: "datetime" },
    ],
    rows: rows.map((d, i) => ({
      ...numberRow(i + 1),
      name: d.key,
      ins: d.ins,
      outs: d.outs,
      total: d.total,
      teu: d.teu,
      peers: list(d.peers),
      lines: list(d.lines),
      first: d.first,
      last: d.last,
    })),
    totals: true,
  });

  const truckTable: ReportTable = {
    columns: [
      { key: "#", header: "#", width: 6, format: "int", total: "label" },
      { key: "truck", header: "Truck No.", width: 14, total: "count" },
      { key: "ins", header: "Gate-ins", width: 10, format: "int", total: "sum" },
      { key: "outs", header: "Gate-outs", width: 10, format: "int", total: "sum" },
      { key: "total", header: "Total Moves", width: 12, format: "int", total: "sum" },
      { key: "teu", header: "TEU Moved", width: 11, format: "int", total: "sum" },
      { key: "peers", header: "Drivers", width: 30 },
      { key: "lines", header: "Lines", width: 16 },
      { key: "first", header: "First Move", width: 18, format: "datetime" },
      { key: "last", header: "Last Move", width: 18, format: "datetime" },
    ],
    rows: trucks.map((t, i) => ({
      ...numberRow(i + 1),
      truck: t.key,
      ins: t.ins,
      outs: t.outs,
      total: t.total,
      teu: t.teu,
      peers: list(t.peers),
      lines: list(t.lines),
      first: t.first,
      last: t.last,
    })),
    totals: true,
  };

  const top = driverTable(drivers.slice(0, 10), "Top 10 drivers by moves");
  top.totals = false;

  return {
    title: "Driver & Truck Activity Report",
    meta: baseMeta(ctx, yardLabel(ids, ctx), [["Period", periodLabel(ctx.period)]]),
    fileName: fileName("Driver_Truck_Activity", ids, ctx),
    sheets: [
      { name: "Summary", kpis, tables: [top] },
      { name: "Drivers", tables: [driverTable(drivers)], detail: true },
      { name: "Trucks", tables: [truckTable], detail: true },
    ],
  };
}
