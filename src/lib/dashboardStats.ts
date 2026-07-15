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

export function last7DayLabels(now: Date = new Date()): { date: Date; label: string }[] {
  return Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(now);
    d.setDate(d.getDate() - (6 - i));
    d.setHours(0, 0, 0, 0);
    const label = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric" });
    return { date: d, label };
  });
}

export function computeDailyTrend<T extends Pick<ContainerLike, "gateInTime">>(
  containers: T[],
  now: Date = new Date(),
): { label: string; count: number }[] {
  return last7DayLabels(now).map(({ date, label }) => {
    const next = new Date(date);
    next.setDate(next.getDate() + 1);
    const count = containers.filter(
      (c) => c.gateInTime >= date && c.gateInTime < next,
    ).length;
    return { label, count };
  });
}

export function computeLineDistribution<T extends Pick<ContainerLike, "shippingLine">>(
  containers: T[],
): { name: string; value: number }[] {
  const map = new Map<string, number>();
  containers.forEach((c) => {
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
      const t = c.containerType.toUpperCase();
      if (t === "20FT") row.small += 1;
      else if (t === "40FT") row.large += 1;
      else if (t === "40HC" || t === "45FT") row.hc += 1;
      else if (t.endsWith("FR")) row.reefer += 1;
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
      const d = daysInYard(c.gateInTime, now);
      if (d <= 7) buckets.fresh += 1;
      else if (d <= 14) buckets.week += 1;
      else if (d <= 21) buckets.twoWeeks += 1;
      else if (d <= 30) buckets.threeWeeks += 1;
      else buckets.stale += 1;
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
