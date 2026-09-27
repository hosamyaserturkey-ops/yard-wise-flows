// The Reports page's filters, translated for the Excel reports. Pure — kept
// apart from fetchReportData.ts so it can be tested without a Supabase client.

import type { ReportContext, ReportVisit } from "./reportData";

export interface ReportFilters {
  dateFrom: string;
  dateTo: string;
  shippingLine: string;
  containerType: string;
  search: string;
}

/** `yyyy-mm-dd` from a date input → inclusive local-day bounds. */
export function periodFromFilters(f: Pick<ReportFilters, "dateFrom" | "dateTo">): ReportContext["period"] {
  const parse = (s: string) => {
    const [y, m, d] = s.split("-").map(Number);
    return y && m && d ? new Date(y, m - 1, d) : undefined;
  };
  const from = f.dateFrom ? parse(f.dateFrom) : undefined;
  const toDay = f.dateTo ? parse(f.dateTo) : undefined;
  const to = toDay ? new Date(toDay.getFullYear(), toDay.getMonth(), toDay.getDate(), 23, 59, 59, 999) : undefined;
  return { from, to };
}

export const active = (v: string) => !!v && v !== "all";

export function filtersLabel(f: ReportFilters): string {
  const parts: string[] = [];
  if (active(f.shippingLine)) parts.push(`Line ${f.shippingLine}`);
  if (active(f.containerType)) parts.push(`Type ${f.containerType}`);
  if (f.search.trim()) parts.push(`Search "${f.search.trim()}"`);
  return parts.join(", ");
}

/** The Reports page's line / type / search filters, applied to report rows. */
export function matchesFilters(v: ReportVisit, f: ReportFilters): boolean {
  if (active(f.shippingLine) && v.shippingLine !== f.shippingLine) return false;
  if (active(f.containerType) && v.containerType !== f.containerType) return false;
  const q = f.search.trim().toLowerCase();
  if (!q) return true;
  return [
    v.containerNumber,
    v.driverName,
    v.truckNumber,
    v.gateOutDriverName,
    v.gateOutTruckNumber,
    v.bookingNumber,
    v.shippingLine,
  ].some((s) =>
    s?.toLowerCase().includes(q),
  );
}
