// Search and filters for the "Available Containers" list on a booking, where
// containers get assigned to it — pure, no React, no Supabase.

import type { Container } from "@/types/container";

/** Filter value meaning "don't narrow on this dimension". */
export const ALL = "all";

export interface AvailableContainerFilters {
  /** Free text: container number, driver or truck. */
  query: string;
  /** Container type code, or ALL. */
  type: string;
  /** Shipping line key (see lineKey), or ALL. */
  line: string;
}

type FilterableContainer = Pick<
  Container,
  "containerNumber" | "containerType" | "shippingLine" | "driverName" | "truckNumber"
>;

/**
 * Lines are stored as shipping_lines spells them, mixed case for some
 * ('7Seas'), so they're compared and grouped case-insensitively.
 */
export const lineKey = (line: string | null | undefined): string => (line ?? "").trim().toUpperCase();

/** Upper-cased with spaces and dashes dropped, so "MSKU 123456-7" finds MSKU1234567. */
const compact = (s: string | null | undefined): string => (s ?? "").replace(/[\s-]+/g, "").toUpperCase();

export function filterAvailableContainers<T extends FilterableContainer>(
  containers: T[],
  filters: AvailableContainerFilters,
): T[] {
  const q = compact(filters.query);
  return containers.filter(
    (c) =>
      (filters.type === ALL || c.containerType === filters.type) &&
      (filters.line === ALL || lineKey(c.shippingLine) === filters.line) &&
      (!q ||
        compact(c.containerNumber).includes(q) ||
        compact(c.driverName).includes(q) ||
        compact(c.truckNumber).includes(q)),
  );
}

/** Types present in `containers`, sorted, for the type dropdown. */
export function typeOptions(containers: FilterableContainer[]): string[] {
  return [...new Set(containers.map((c) => c.containerType).filter(Boolean))].sort();
}

/**
 * Lines present in `containers` as { key, label }, sorted, for the line
 * dropdown. The label is the first spelling seen for that line.
 */
export function lineOptions(containers: FilterableContainer[]): { key: string; label: string }[] {
  const byKey = new Map<string, string>();
  for (const c of containers) {
    const key = lineKey(c.shippingLine);
    if (key && !byKey.has(key)) byKey.set(key, c.shippingLine.trim());
  }
  return [...byKey].map(([key, label]) => ({ key, label })).sort((a, b) => a.key.localeCompare(b.key));
}
