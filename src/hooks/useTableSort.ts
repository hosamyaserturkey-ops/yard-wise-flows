import { useCallback, useMemo, useState } from "react";

export type SortDirection = "asc" | "desc";

export interface SortState<K extends string> {
  key: K;
  direction: SortDirection;
}

/**
 * Local sort state for a table, plus the sorted rows.
 *
 * `values` maps a row to a primitive per column key; numbers are compared
 * numerically and strings case-insensitively. Pair with the `SortHeader`
 * component to render the clickable column headers.
 */
export function useTableSort<T, K extends string>(
  rows: T[],
  values: (row: T) => Record<K, string | number>,
  initial: SortState<K>,
) {
  const [sort, setSort] = useState<SortState<K>>(initial);

  const toggle = useCallback((key: K) => {
    setSort((prev) =>
      prev.key === key
        ? { key, direction: prev.direction === "asc" ? "desc" : "asc" }
        : // A newly picked column starts descending — "biggest first" is what
          // readers expect from these count-heavy tables.
          { key, direction: "desc" },
    );
  }, []);

  const sorted = useMemo(() => {
    const factor = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = values(a)[sort.key];
      const bv = values(b)[sort.key];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * factor;
      return String(av).localeCompare(String(bv), undefined, { sensitivity: "base" }) * factor;
    });
    // `values` is an inline lambda at every call site; rows + sort are the
    // inputs that actually change the result.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort]);

  return { sort, toggle, sorted };
}
