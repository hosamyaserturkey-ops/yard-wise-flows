import { formatMonthYear } from "@/lib/format";

/**
 * Accounting math for demurrage collections.
 *
 * The yard collects two things at the gate: the demurrage the shipping line
 * charges for the container's overstay, and the yard's own service fee.
 *
 *   total_collected = demurrage_amount + service_fee
 *
 * Demurrage is collected on the shipping line's behalf — every fils of it is
 * owed onward to that line. The service fee is what the yard actually earns.
 * The stored `yard_share` / `shipping_line_share` columns predate that rule
 * (they split the service fee instead), so everything here is derived from
 * `demurrage_amount` and `service_fee` and older rows report correctly too.
 *
 * The dinar has three decimals (1 JOD = 1000 fils). Sums are kept in whole
 * fils so a long column of payments never drifts by a floating-point fraction.
 *
 * A voided (refunded) payment was handed back, so it counts nowhere: every
 * function here skips it.
 */

export interface AccountingPayment {
  id?: string;
  shipping_line: string;
  demurrage_amount: number | string | null;
  service_fee: number | string | null;
  total_collected: number | string | null;
  payment_method?: string | null;
  created_at?: string;
  transferred: boolean;
  voided_at?: string | null;
  void_reason?: string | null;
}

export interface AccountingSummary {
  /** Everything taken at the counter: demurrage + service fees. */
  totalCollected: number;
  /** The yard's own revenue — service fees only. */
  yardEarnings: number;
  /** Demurrage collected but not yet transferred to the shipping lines. */
  pendingTransfers: number;
}

/** How long demurrage has been held since it was collected. */
export interface OwedAging {
  days0to7: number;
  days8to30: number;
  days31to60: number;
  days61plus: number;
}

export interface ShippingLineOwed {
  shipping_line: string;
  /** Untransferred payments for this line. */
  count: number;
  /** Demurrage owed onward to this line. */
  totalOwed: number;
  transferred: boolean;
  /** The untransferred payments — exactly what settling this row covers. */
  paymentIds: string[];
  /** When the oldest untransferred payment was collected. */
  oldestPendingAt: string | null;
  aging: OwedAging;
}

export interface DailyClose {
  /** Local calendar day, YYYY-MM-DD. */
  date: string;
  count: number;
  demurrage: number;
  fees: number;
  total: number;
  /** Total collected per payment method (cash, qlick, …). */
  byMethod: Record<string, number>;
}

const amount = (value: number | string | null | undefined): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

const toFils = (jod: number): number => Math.round(jod * 1000);
const fromFils = (fils: number): number => fils / 1000;

/** Sums JOD amounts exactly, to the fils. */
export const sumJod = (values: Iterable<number | string | null | undefined>): number => {
  let fils = 0;
  for (const v of values) fils += toFils(amount(v));
  return fromFils(fils);
};

/** "1,234.500 JOD" — three decimals, as the dinar is written. */
export const formatJod = (value: number | string | null | undefined): string =>
  `${amount(value).toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} JOD`;

/** False for a payment that was voided (refunded). */
export const isActivePayment = (payment: AccountingPayment): boolean => !payment.voided_at;

/** Demurrage owed to the shipping line for a single payment. */
export const shippingLineOwed = (payment: AccountingPayment): number =>
  amount(payment.demurrage_amount);

/** Yard revenue from a single payment — the service fee, nothing else. */
export const yardEarned = (payment: AccountingPayment): number =>
  amount(payment.service_fee);

export const summarizePayments = (all: AccountingPayment[]): AccountingSummary => {
  const payments = all.filter(isActivePayment);
  return {
    totalCollected: sumJod(payments.map((p) => p.total_collected)),
    yardEarnings: sumJod(payments.map(yardEarned)),
    pendingTransfers: sumJod(payments.filter((p) => !p.transferred).map(shippingLineOwed)),
  };
};

const DAY_MS = 86_400_000;

const emptyAging = (): OwedAging => ({ days0to7: 0, days8to30: 0, days31to60: 0, days61plus: 0 });

/** Which aging bucket a payment collected at `collectedAt` falls in on `now`. */
export const agingBucket = (collectedAt: string | undefined, now: Date): keyof OwedAging => {
  const t = collectedAt ? new Date(collectedAt).getTime() : NaN;
  const days = Number.isFinite(t) ? Math.floor((now.getTime() - t) / DAY_MS) : 0;
  if (days <= 7) return "days0to7";
  if (days <= 30) return "days8to30";
  if (days <= 60) return "days31to60";
  return "days61plus";
};

/**
 * Per-line demurrage still owed, with its age. Lines with a recorded transfer
 * but nothing outstanding are listed as settled so their history stays
 * reachable.
 */
export const buildShippingLineBreakdown = (
  payments: AccountingPayment[],
  transferredLines: Iterable<string>,
  now: Date = new Date(),
): ShippingLineOwed[] => {
  interface Acc { count: number; fils: number; ids: string[]; oldest: string | null; aging: Record<keyof OwedAging, number> }
  const pending = new Map<string, Acc>();
  payments.forEach((p) => {
    if (p.transferred || !isActivePayment(p)) return;
    const acc = pending.get(p.shipping_line)
      ?? { count: 0, fils: 0, ids: [], oldest: null, aging: emptyAging() };
    const owedFils = toFils(shippingLineOwed(p));
    acc.count += 1;
    acc.fils += owedFils;
    if (p.id) acc.ids.push(p.id);
    if (p.created_at && (!acc.oldest || p.created_at < acc.oldest)) acc.oldest = p.created_at;
    acc.aging[agingBucket(p.created_at, now)] += owedFils;
    pending.set(p.shipping_line, acc);
  });

  const rows: ShippingLineOwed[] = [];
  pending.forEach((v, line) => rows.push({
    shipping_line: line,
    count: v.count,
    totalOwed: fromFils(v.fils),
    transferred: false,
    paymentIds: v.ids,
    oldestPendingAt: v.oldest,
    aging: {
      days0to7: fromFils(v.aging.days0to7),
      days8to30: fromFils(v.aging.days8to30),
      days31to60: fromFils(v.aging.days31to60),
      days61plus: fromFils(v.aging.days61plus),
    },
  }));
  for (const line of transferredLines) {
    if (!pending.has(line)) {
      rows.push({
        shipping_line: line, count: 0, totalOwed: 0, transferred: true,
        paymentIds: [], oldestPendingAt: null, aging: emptyAging(),
      });
    }
  }
  return rows;
};

/** Local calendar day of an ISO timestamp, YYYY-MM-DD. */
export const localDateKey = (iso: string): string => {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/**
 * What the counter should hold at the end of each day, per payment method —
 * the figures a cashier's drawer is counted against. Newest day first.
 */
export const buildDailyClose = (payments: AccountingPayment[]): DailyClose[] => {
  interface Acc { count: number; demurrage: number; fees: number; total: number; byMethod: Map<string, number> }
  const days = new Map<string, Acc>();
  for (const p of payments) {
    if (!p.created_at || !isActivePayment(p)) continue;
    const key = localDateKey(p.created_at);
    const acc = days.get(key) ?? { count: 0, demurrage: 0, fees: 0, total: 0, byMethod: new Map() };
    const totalFils = toFils(amount(p.total_collected));
    const method = p.payment_method || "unknown";
    acc.count += 1;
    acc.demurrage += toFils(shippingLineOwed(p));
    acc.fees += toFils(yardEarned(p));
    acc.total += totalFils;
    acc.byMethod.set(method, (acc.byMethod.get(method) ?? 0) + totalFils);
    days.set(key, acc);
  }
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([date, v]) => ({
      date,
      count: v.count,
      demurrage: fromFils(v.demurrage),
      fees: fromFils(v.fees),
      total: fromFils(v.total),
      byMethod: Object.fromEntries([...v.byMethod].map(([m, f]) => [m, fromFils(f)])),
    }));
};

export interface StatementTransfer {
  shipping_line: string;
  amount_transferred: number | string;
  transferred_at: string;
  voided_at?: string | null;
}

/** What the yard held for one line over a period. */
export interface LineStatementRow {
  shipping_line: string;
  /** Owed at the start: demurrage collected before, minus transfers before. */
  opening: number;
  /** Demurrage collected during the period. */
  collected: number;
  /** Transferred to the line during the period. */
  transferred: number;
  /** opening + collected − transferred. */
  closing: number;
}

/**
 * The per-line statement for [start, end): the same figures the server
 * snapshots when a month is closed. Voided payments and transfers are ignored.
 */
export const buildLineStatement = (
  payments: AccountingPayment[],
  transfers: StatementTransfer[],
  start: Date,
  end: Date,
): LineStatementRow[] => {
  const s = start.getTime();
  const e = end.getTime();
  interface Acc { opening: number; collected: number; transferred: number }
  const byLine = new Map<string, Acc>();
  const acc = (line: string) => {
    let a = byLine.get(line);
    if (!a) { a = { opening: 0, collected: 0, transferred: 0 }; byLine.set(line, a); }
    return a;
  };
  for (const p of payments) {
    if (!isActivePayment(p) || !p.created_at) continue;
    const t = new Date(p.created_at).getTime();
    if (t >= e) continue;
    const fils = toFils(shippingLineOwed(p));
    if (t < s) acc(p.shipping_line).opening += fils;
    else acc(p.shipping_line).collected += fils;
  }
  for (const tr of transfers) {
    if (tr.voided_at) continue;
    const t = new Date(tr.transferred_at).getTime();
    if (t >= e) continue;
    const fils = toFils(amount(tr.amount_transferred));
    if (t < s) acc(tr.shipping_line).opening -= fils;
    else acc(tr.shipping_line).transferred += fils;
  }
  return [...byLine.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([line, a]) => ({
      shipping_line: line,
      opening: fromFils(a.opening),
      collected: fromFils(a.collected),
      transferred: fromFils(a.transferred),
      closing: fromFils(a.opening + a.collected - a.transferred),
    }));
};

/** Local start of the month `YYYY-MM`, and the start of the next one. */
export const monthRange = (key: string): { start: Date; end: Date } => {
  const [y, m] = key.split("-").map(Number);
  return { start: new Date(y, m - 1, 1), end: new Date(y, m, 1) };
};

/** `YYYY-MM` of a date, local time. */
export const monthKey = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

/** The last `count` month keys, newest first, starting with `from`'s month. */
export const recentMonths = (count: number, from: Date = new Date()): string[] =>
  Array.from({ length: count }, (_, i) => monthKey(new Date(from.getFullYear(), from.getMonth() - i, 1)));

export const monthLabel = (key: string): string =>
  formatMonthYear(monthRange(key).start);
