// Cross-filter state for the dashboard — pure, no React, no Supabase.
// Every visual on the dashboard (donut slice, trend bar, aging row, stock cell)
// toggles one of these dimensions, and every derived stat is computed from a
// scoped container list.

import {
  agingBucketOf,
  dayKey,
  sizeBucketOf,
  SIZE_BUCKET_LABELS,
  AGING_BUCKETS,
  type AgingBucketKey,
  type SizeBucket,
} from "./dashboardStats";

export interface DashboardFilters {
  /** Shipping line — donut slice, stock-table row. */
  line: string | null;
  /** Age band of in-yard containers — aging row. */
  bucket: AgingBucketKey | null;
  /** `yyyy-mm-dd` gate-in day — trend bar. */
  day: string | null;
  /** Container size bucket — stock-table cell. */
  size: SizeBucket | null;
}

export type FilterDimension = keyof DashboardFilters;

export const EMPTY_FILTERS: DashboardFilters = {
  line: null,
  bucket: null,
  day: null,
  size: null,
};

export const hasActiveFilters = (f: DashboardFilters): boolean =>
  Object.values(f).some((v) => v !== null);

interface FilterableContainer {
  status: string;
  containerType: string;
  shippingLine: string;
  gateInTime: Date;
}

/**
 * Apply every active filter to `containers`.
 *
 * Pass `exclude` to skip one dimension. Charts use this so that clicking a mark
 * doesn't collapse the chart it came from — the donut stays scoped by day/age/size
 * but keeps showing all lines, with the unselected ones dimmed.
 */
export function scopeContainers<T extends FilterableContainer>(
  containers: T[],
  filters: DashboardFilters,
  opts: { exclude?: FilterDimension | FilterDimension[] } = {},
  now: Date = new Date(),
): T[] {
  const excluded = new Set(
    opts.exclude === undefined
      ? []
      : Array.isArray(opts.exclude)
        ? opts.exclude
        : [opts.exclude],
  );
  const active = <K extends FilterDimension>(key: K): DashboardFilters[K] | null =>
    excluded.has(key) ? null : filters[key];

  const line = active("line");
  const bucket = active("bucket");
  const day = active("day");
  const size = active("size");

  return containers.filter((c) => {
    if (line !== null && c.shippingLine !== line) return false;
    if (day !== null && dayKey(c.gateInTime) !== day) return false;
    if (size !== null && sizeBucketOf(c.containerType) !== size) return false;
    // Age bands only describe containers still in the yard, matching how the
    // aging card counts them.
    if (bucket !== null) {
      if (c.status !== "in-yard") return false;
      if (agingBucketOf(c.gateInTime, now) !== bucket) return false;
    }
    return true;
  });
}

export interface FilterChip {
  key: FilterDimension;
  label: string;
  value: string;
}

/** Active filters as display chips, in a stable order. */
export function describeFilters(filters: DashboardFilters): FilterChip[] {
  const chips: FilterChip[] = [];

  if (filters.line !== null) {
    chips.push({ key: "line", label: "Line", value: filters.line });
  }
  if (filters.size !== null) {
    chips.push({ key: "size", label: "Size", value: SIZE_BUCKET_LABELS[filters.size] });
  }
  if (filters.bucket !== null) {
    const band = AGING_BUCKETS.find((b) => b.key === filters.bucket);
    chips.push({ key: "bucket", label: "Age", value: band?.label ?? filters.bucket });
  }
  if (filters.day !== null) {
    chips.push({ key: "day", label: "Gate-in", value: formatDayKey(filters.day) });
  }

  return chips;
}

/** `2026-07-15` → `15 Jul 2026`. Parsed as local time, not UTC. */
export function formatDayKey(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  if (!y || !m || !d) return key;
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Toggle a dimension: selecting the active value again clears it. */
export function toggleFilter<K extends FilterDimension>(
  filters: DashboardFilters,
  key: K,
  value: NonNullable<DashboardFilters[K]>,
): DashboardFilters {
  return { ...filters, [key]: filters[key] === value ? null : value };
}
