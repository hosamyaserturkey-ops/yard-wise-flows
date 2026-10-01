// Where each container on a line's port list stands: still out (and whether
// it's past its free time), in the yard, or already gated out — with the last
// free day and the demurrage due. Pure, so the Port Data page's numbers and
// its Excel export are unit-tested.

import { calculateDemurrage, firstGateInOfTrip, hasDemurrageRules, lastFreeDay } from "@/lib/demurrage";
import type { ReportSpec } from "@/lib/reports/reportModel";

export interface PortListEntry {
  container_number: string;
  shipping_line: string;
  container_type: string | null;
  port_arrival_date: string;
  free_days: number;
  yard_id?: string | null;
  last_source?: string | null;
  updated_at?: string | null;
}

export interface VisitLite {
  gate_in_time: string;
  gate_out_time: string | null;
  /** What the gate operator recorded at gate-in. */
  port_arrival_date: string | null;
  free_days: number | null;
  /** Lists are kept per yard, so a visit only counts for the same yard's row. */
  yard_id?: string | null;
}

export type PortListStatus = "awaiting" | "in_yard" | "gated_out";

export interface PortListRow extends PortListEntry {
  status: PortListStatus;
  lastFreeDay: string | null;
  /** First gate-in of this trip (on or after the arrival date), if any. */
  gateInTime: Date | null;
  gateOutTime: Date | null;
  /** Chargeable days: as of today while out, as of gate-in once returned. */
  daysOver: number;
  demurrageUSD: number;
  demurrageJOD: number;
  /** Arrival date the gate recorded when it differs from the list's. */
  recordedArrival: string | null;
  recordedFreeDays: number | null;
}

const dateOnly = (v: string | null | undefined) => (v ? v.slice(0, 10) : null);

export function buildPortListRows(
  entries: PortListEntry[],
  visitsByContainer: Map<string, VisitLite[]>,
  today: Date = new Date(),
): PortListRow[] {
  return entries.map((entry) => {
    const visits = (visitsByContainer.get(entry.container_number) ?? []).filter(
      (v) => !entry.yard_id || !v.yard_id || v.yard_id === entry.yard_id,
    );
    const gateIn = firstGateInOfTrip(
      visits.map((v) => new Date(v.gate_in_time)),
      entry.port_arrival_date,
    );
    const visit = gateIn ? visits.find((v) => new Date(v.gate_in_time).getTime() === gateIn.getTime()) ?? null : null;
    const status: PortListStatus = !visit ? "awaiting" : visit.gate_out_time ? "gated_out" : "in_yard";

    const charged = hasDemurrageRules(entry.shipping_line);
    const result = calculateDemurrage(
      entry.shipping_line,
      entry.container_type ?? "",
      entry.port_arrival_date,
      gateIn ?? today,
      entry.free_days,
    );
    const daysOver = charged && !result.error ? Math.max(0, result.daysElapsed - result.freeDays) : 0;

    const recordedArrival = dateOnly(visit?.port_arrival_date);
    const recordedFreeDays = visit?.free_days ?? null;
    return {
      ...entry,
      status,
      lastFreeDay: lastFreeDay(entry.port_arrival_date, entry.free_days),
      gateInTime: gateIn,
      gateOutTime: visit?.gate_out_time ? new Date(visit.gate_out_time) : null,
      daysOver,
      demurrageUSD: result.totalUSD,
      demurrageJOD: result.totalJOD,
      recordedArrival: recordedArrival && recordedArrival !== entry.port_arrival_date ? recordedArrival : null,
      recordedFreeDays: visit && recordedFreeDays !== entry.free_days ? recordedFreeDays : null,
    };
  });
}

export interface PortListSummary {
  listed: number;
  awaiting: number;
  /** Still out and past free time — accruing demurrage now. */
  overdue: number;
  overdueUSD: number;
  overdueJOD: number;
  inYard: number;
  gatedOut: number;
  /** Returned containers whose recorded arrival or free days differ from the list. */
  mismatched: number;
}

export function summarizePortList(rows: PortListRow[]): PortListSummary {
  const s: PortListSummary = {
    listed: rows.length, awaiting: 0, overdue: 0, overdueUSD: 0, overdueJOD: 0, inYard: 0, gatedOut: 0, mismatched: 0,
  };
  for (const r of rows) {
    if (r.status === "awaiting") {
      s.awaiting += 1;
      if (r.daysOver > 0) {
        s.overdue += 1;
        s.overdueUSD += r.demurrageUSD;
        s.overdueJOD += r.demurrageJOD;
      }
    } else if (r.status === "in_yard") s.inYard += 1;
    else s.gatedOut += 1;
    if (r.recordedArrival || r.recordedFreeDays != null) s.mismatched += 1;
  }
  s.overdueUSD = Math.round(s.overdueUSD * 100) / 100;
  s.overdueJOD = Math.round(s.overdueJOD * 100) / 100;
  return s;
}

// ── Excel export ────────────────────────────────────────────────────────────

const STATUS_LABEL: Record<PortListStatus, string> = {
  awaiting: "Not returned",
  in_yard: "In yard",
  gated_out: "Gated out",
};

export const portListStatusLabel = (row: Pick<PortListRow, "status" | "daysOver">) =>
  row.status === "awaiting" && row.daysOver > 0 ? "Not returned — past free time" : STATUS_LABEL[row.status];

/** YYYY-MM-DD → local-midnight Date, which the workbook writes as that calendar day. */
const localDay = (iso: string | null): Date | null => {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/**
 * The port list as a workbook, laid out like the lines' own sheets (arrival,
 * free days, last free day, demurrage) plus where each container is now, so
 * it can go straight back to the line.
 */
export function buildPortListReport(
  rows: PortListRow[],
  meta: { title: string; yard: string; generatedBy: string; filter: string; asOf: Date; fileName: string },
): ReportSpec {
  const s = summarizePortList(rows);
  return {
    title: meta.title,
    meta: [
      ["Yard", meta.yard],
      ["Showing", meta.filter],
      ["Demurrage as of", meta.asOf.toLocaleDateString("en-GB")],
      ["Generated", `${meta.asOf.toLocaleString("en-GB")} by ${meta.generatedBy}`],
    ],
    fileName: meta.fileName,
    sheets: [
      {
        name: "Port list",
        detail: true,
        kpis: [
          { label: "Listed", value: s.listed, format: "int" },
          { label: "Not returned", value: s.awaiting, format: "int" },
          { label: "Past free time", value: s.overdue, format: "int" },
          { label: "Owed by those (USD)", value: s.overdueUSD, format: "money" },
          { label: "In yard", value: s.inYard, format: "int" },
        ],
        tables: [
          {
            columns: [
              { key: "n", header: "#", width: 6, format: "int" },
              { key: "container", header: "Container Id", width: 16, total: "label" },
              { key: "line", header: "Line", width: 8 },
              { key: "size", header: "Size", width: 8 },
              { key: "arrival", header: "Vessel Arrival Date", width: 16, format: "date" },
              { key: "free", header: "Free Days", width: 10, format: "int" },
              { key: "lfd", header: "Last Free Day", width: 14, format: "date" },
              { key: "status", header: "Status", width: 26 },
              { key: "gateIn", header: "Gate-in", width: 18, format: "datetime" },
              { key: "daysOver", header: "Days over free time", width: 12, format: "int", total: "sum" },
              { key: "usd", header: "Demurrage (USD)", width: 14, format: "money", total: "sum" },
              { key: "jod", header: "Demurrage (JOD)", width: 14, format: "money", total: "sum" },
            ],
            rows: rows.map((r, i) => ({
              n: i + 1,
              container: r.container_number,
              line: r.shipping_line,
              size: r.container_type,
              arrival: localDay(r.port_arrival_date),
              free: r.free_days,
              lfd: localDay(r.lastFreeDay),
              status: portListStatusLabel(r),
              gateIn: r.gateInTime,
              daysOver: r.daysOver,
              usd: r.demurrageUSD,
              jod: r.demurrageJOD,
            })),
            totals: true,
            note: "Demurrage counts to today for containers not yet returned, and to the gate-in for returned ones.",
          },
        ],
      },
    ],
  };
}
