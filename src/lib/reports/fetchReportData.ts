// Loads the rows the Excel reports need, straight from Supabase.
//
// Reports fetch their own data rather than reuse the Reports page's list: that
// list is a single request, and PostgREST caps a response (1000 rows by
// default), so on a busy yard the oldest visits — exactly the long-stay
// containers an in-yard report exists to show — would silently drop off.

import { supabase } from "@/integrations/supabase/client";
import { mapVisit, VISIT_WITH_CONTAINER, type VisitJoinRow } from "@/lib/containerMap";
import type { ReportContext, ReportKind, ReportPayment, ReportVisit } from "./reportData";
import { active, matchesFilters, periodFromFilters, type ReportFilters } from "./reportFilters";

const PAGE = 1000;

type PageResult<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** Keeps requesting pages until a short page says there is no more. */
async function fetchAll<T>(page: (from: number, to: number) => PageResult<T>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

/** PostgREST filter for "column inside the period"; null when the period is open. */
function inPeriodFilter(column: string, period: ReportContext["period"]): string | null {
  const parts: string[] = [];
  if (period.from) parts.push(`${column}.gte.${period.from.toISOString()}`);
  if (period.to) parts.push(`${column}.lte.${period.to.toISOString()}`);
  if (parts.length === 0) return null;
  return parts.length === 1 ? parts[0] : `and(${parts.join(",")})`;
}

type RawVisit = VisitJoinRow & { created_by: string | null; gated_out_by: string | null };

async function fetchVisits(kind: ReportKind, period: ReportContext["period"]): Promise<RawVisit[]> {
  return fetchAll<RawVisit>((from, to) => {
    let q = supabase.from("container_visits").select(VISIT_WITH_CONTAINER);
    if (kind === "in-yard") {
      q = q.in("status", ["in-yard", "reserved"]);
    } else if (kind === "fees") {
      q = q.not("gate_out_time", "is", null);
      if (period.from) q = q.gte("gate_out_time", period.from.toISOString());
      if (period.to) q = q.lte("gate_out_time", period.to.toISOString());
    } else {
      const inF = inPeriodFilter("gate_in_time", period);
      const outF = inPeriodFilter("gate_out_time", period);
      if (inF && outF) q = q.or(`${inF},${outF}`);
    }
    return q.order("id").range(from, to) as unknown as PageResult<RawVisit>;
  });
}

async function fetchPayments(period: ReportContext["period"]) {
  return fetchAll<{
    created_at: string;
    yard_id: string;
    container_number: string;
    shipping_line: string;
    chargeable_days: number;
    demurrage_amount: number | string;
    service_fee: number | string;
    total_collected: number | string;
    payment_method: string;
    transferred: boolean;
    collected_by: string;
  }>((from, to) => {
    let q = supabase.from("demurrage_payments").select("*");
    if (period.from) q = q.gte("created_at", period.from.toISOString());
    if (period.to) q = q.lte("created_at", period.to.toISOString());
    return q.order("id").range(from, to);
  });
}

/**
 * user id → display name. Best-effort: line reps cannot read the yard roster,
 * so an unreadable profile just leaves the operator column blank.
 */
async function fetchNames(ids: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const unique = Array.from(new Set(ids.filter(Boolean)));
  for (let i = 0; i < unique.length; i += 100) {
    const { data } = await supabase
      .from("profiles")
      .select("user_id, full_name, username")
      .in("user_id", unique.slice(i, i + 100));
    for (const p of data ?? []) {
      const name = p.full_name?.trim() || p.username?.trim();
      if (name) names.set(p.user_id, name);
    }
  }
  return names;
}

export async function fetchYards(): Promise<{ id: string; name: string; code: string }[]> {
  const { data } = await supabase.from("yards").select("id, name, code");
  return data ?? [];
}

export interface LoadedReportData {
  visits: ReportVisit[];
  payments: ReportPayment[];
}

export async function loadReportData(kind: ReportKind, filters: ReportFilters): Promise<LoadedReportData> {
  const period = kind === "in-yard" ? {} : periodFromFilters(filters);
  const [rawVisits, rawPayments] = await Promise.all([
    fetchVisits(kind, period),
    kind === "fees" ? fetchPayments(period) : Promise.resolve([]),
  ]);

  const names = await fetchNames([
    ...rawVisits.flatMap((v) => [v.created_by ?? "", v.gated_out_by ?? ""]),
    ...rawPayments.map((p) => p.collected_by),
  ]);

  const visits: ReportVisit[] = rawVisits
    .map((raw) => {
      const c = mapVisit(raw);
      return {
        id: c.id,
        yardId: c.yardId ?? raw.yard_id,
        ticketNumber: c.ticketNumber,
        containerNumber: c.containerNumber,
        containerType: c.containerType,
        shippingLine: c.shippingLine,
        driverName: c.driverName,
        truckNumber: c.truckNumber,
        gateOutDriverName: c.gateOutDriverName,
        gateOutTruckNumber: c.gateOutTruckNumber,
        gateInTime: c.gateInTime,
        gateOutTime: c.gateOutTime,
        status: c.status,
        bookingNumber: c.bookingNumber,
        sealNumber: c.sealNumber,
        fees: c.fees,
        yardBlock: c.yardBlock,
        yardRow: c.yardRow,
        portArrivalDate: raw.port_arrival_date ?? undefined,
        receivedBy: (raw.created_by && names.get(raw.created_by)) || undefined,
        releasedBy: (raw.gated_out_by && names.get(raw.gated_out_by)) || undefined,
      };
    })
    .filter((v) => matchesFilters(v, filters));

  const q = filters.search.trim().toLowerCase();
  const payments: ReportPayment[] = rawPayments
    .filter((p) => !active(filters.shippingLine) || p.shipping_line === filters.shippingLine)
    .filter((p) => !q || p.container_number.toLowerCase().includes(q) || p.shipping_line.toLowerCase().includes(q))
    .map((p) => ({
      createdAt: new Date(p.created_at),
      yardId: p.yard_id,
      containerNumber: p.container_number,
      shippingLine: p.shipping_line,
      chargeableDays: Number(p.chargeable_days ?? 0),
      demurrageAmount: Number(p.demurrage_amount ?? 0),
      serviceFee: Number(p.service_fee ?? 0),
      totalCollected: Number(p.total_collected ?? 0),
      paymentMethod: p.payment_method,
      transferred: p.transferred,
      collectedBy: names.get(p.collected_by),
    }));

  return { visits, payments };
}
