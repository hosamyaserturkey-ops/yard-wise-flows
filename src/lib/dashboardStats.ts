// Pure dashboard statistics helpers — no React, no Supabase.
// Every function takes an optional `now` so calculations are testable.

export interface StockRow {
  line: string;
  small: number;
  large: number;
  hc: number;
  reefer: number;
  total: number;
}

export interface AgingBuckets {
  fresh: number;
  week: number;
  twoWeeks: number;
  threeWeeks: number;
  stale: number;
}

export type AgingBucketKey = keyof AgingBuckets;

/**
 * Single source of truth for the age bands. The aging card renders from this
 * list and the dashboard's age filter buckets containers with `agingBucketOf`,
 * so the boundaries can never drift apart.
 */
export const AGING_BUCKETS: {
  key: AgingBucketKey;
  label: string;
  tone: string;
  maxDays: number;
}[] = [
  { key: "fresh", label: "0–7 days", tone: "bg-success", maxDays: 7 },
  { key: "week", label: "8–14 days", tone: "bg-maritime", maxDays: 14 },
  { key: "twoWeeks", label: "15–21 days", tone: "bg-warning", maxDays: 21 },
  { key: "threeWeeks", label: "22–30 days", tone: "bg-container", maxDays: 30 },
  { key: "stale", label: "30+ days", tone: "bg-destructive", maxDays: Infinity },
];

/** Size buckets used by the stock-by-line table and the dashboard size filter. */
export type SizeBucket = "small" | "large" | "hc" | "reefer";

export const SIZE_BUCKET_LABELS: Record<SizeBucket, string> = {
  small: "20FT",
  large: "40FT",
  hc: "40HC/45",
  reefer: "Reefer",
};

interface ContainerLike {
  status: string;
  containerType: string;
  shippingLine: string;
  gateInTime: Date;
  gateOutTime?: Date;
}

export function daysInYard(gateInTime: Date, now: Date = new Date()): number {
  const ms = now.getTime() - gateInTime.getTime();
  return Math.max(0, Math.floor(ms / (1000 * 60 * 60 * 24)));
}

export function timeAgo(date: Date, now: Date = new Date()): string {
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Stable local-time `yyyy-mm-dd` key — used to identify a selected trend day. */
export function dayKey(date: Date): string {
  const m = `${date.getMonth() + 1}`.padStart(2, "0");
  const d = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${m}-${d}`;
}

/** Which age band a container falls into, by whole days since gate-in. */
export function agingBucketOf(gateInTime: Date, now: Date = new Date()): AgingBucketKey {
  const d = daysInYard(gateInTime, now);
  return (AGING_BUCKETS.find((b) => d <= b.maxDays) ?? AGING_BUCKETS[AGING_BUCKETS.length - 1]).key;
}

/**
 * Map a raw container type onto a stock-table size bucket.
 *
 * Types are ISO 6346 group codes (see containerTypes.ts): a two-character size
 * prefix (20/40/45) plus a two-character type suffix (GP/HC/RF/RH/FR/OT/TK),
 * alongside the legacy 20FT/40FT/45FT codes. Matching is on prefix and suffix
 * rather than whole codes so a new group code buckets correctly on its own.
 *
 * Buckets are mutually exclusive, so the stock table's columns always sum to
 * its total: reefers count as Reefer rather than under their size, and every
 * other type falls to its size. Note FR is Flat Rack — a reefer is RF or RH.
 */
export function sizeBucketOf(containerType: string): SizeBucket | null {
  const t = containerType.toUpperCase().trim();
  if (t.endsWith("RF") || t.endsWith("RH")) return "reefer";
  if (t.startsWith("45") || t === "40HC") return "hc";
  if (t.startsWith("20")) return "small";
  if (t.startsWith("40")) return "large";
  return null;
}

/** The last `days` midnights ending today, oldest first. */
export function lastNDayLabels(
  days: number,
  now: Date = new Date(),
): { date: Date; label: string }[] {
  // Longer windows drop the weekday so the axis stays legible.
  const format: Intl.DateTimeFormatOptions =
    days > 14 ? { day: "numeric", month: "short" } : { weekday: "short", day: "numeric" };

  return Array.from({ length: days }).map((_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (days - 1 - i));
    d.setHours(0, 0, 0, 0);
    return { date: d, label: d.toLocaleDateString("en-GB", format) };
  });
}

export function last7DayLabels(now: Date = new Date()): { date: Date; label: string }[] {
  return lastNDayLabels(7, now);
}

export interface TrendPoint {
  label: string;
  /** `yyyy-mm-dd` of this bar, for filtering on click. */
  dayKey: string;
  gateIn: number;
  gateOut: number;
}

export function computeDailyTrend<
  T extends Pick<ContainerLike, "gateInTime" | "gateOutTime">,
>(containers: T[], days = 7, now: Date = new Date()): TrendPoint[] {
  return lastNDayLabels(days, now).map(({ date, label }) => {
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    const inWindow = (d?: Date) => !!d && d >= date && d < next;
    return {
      label,
      dayKey: dayKey(date),
      gateIn: containers.filter((c) => inWindow(c.gateInTime)).length,
      gateOut: containers.filter((c) => inWindow(c.gateOutTime)).length,
    };
  });
}

export function computeLineDistribution<
  T extends Pick<ContainerLike, "shippingLine" | "status">,
>(containers: T[]): { name: string; value: number }[] {
  const map = new Map<string, number>();
  containers
    .filter((c) => c.status === "in-yard")
    .forEach((c) => {
      map.set(c.shippingLine, (map.get(c.shippingLine) ?? 0) + 1);
    });
  return Array.from(map.entries())
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value);
}

// Per-line stock of in-yard containers, split by size bucket.
export function computeStockByLine<
  T extends Pick<ContainerLike, "status" | "containerType" | "shippingLine">,
>(containers: T[]): StockRow[] {
  const map = new Map<string, Omit<StockRow, "line">>();
  containers
    .filter((c) => c.status === "in-yard")
    .forEach((c) => {
      const row = map.get(c.shippingLine) ?? { small: 0, large: 0, hc: 0, reefer: 0, total: 0 };
      const bucket = sizeBucketOf(c.containerType);
      if (bucket) row[bucket] += 1;
      // `total` is the authoritative in-yard count, so it matches the KPI cards
      // and the by-line donut. Every type the app can store buckets, so the four
      // columns reconcile with it; only unrecognisable data would break the sum.
      row.total += 1;
      map.set(c.shippingLine, row);
    });
  return Array.from(map.entries())
    .map(([line, v]) => ({ line, ...v }))
    .sort((a, b) => b.total - a.total);
}

export function computeAgingBuckets<
  T extends Pick<ContainerLike, "status" | "gateInTime">,
>(containers: T[], now: Date = new Date()): AgingBuckets {
  const buckets: AgingBuckets = { fresh: 0, week: 0, twoWeeks: 0, threeWeeks: 0, stale: 0 };
  containers
    .filter((c) => c.status === "in-yard")
    .forEach((c) => {
      buckets[agingBucketOf(c.gateInTime, now)] += 1;
    });
  return buckets;
}

export function computeTodayActivity<
  T extends Pick<ContainerLike, "status" | "gateInTime" | "gateOutTime">,
>(containers: T[], now: Date = new Date()): { gateIn: number; gateOut: number; reserved: number } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const gateIn = containers.filter((c) => c.gateInTime >= start && c.gateInTime < end).length;
  const gateOut = containers.filter(
    (c) => c.gateOutTime && c.gateOutTime >= start && c.gateOutTime < end,
  ).length;
  const reserved = containers.filter((c) => c.status === "reserved").length;
  return { gateIn, gateOut, reserved };
}
