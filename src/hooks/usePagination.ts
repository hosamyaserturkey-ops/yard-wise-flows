import { useEffect, useMemo, useState } from "react";

/**
 * Splits a list into pages. Goes back to page 1 when `resetKey` changes (pass
 * the filters and search), so a new filter never lands on an empty page but a
 * background refresh of the data doesn't move someone off the page they're on.
 */
export function usePagination<T>(items: T[], pageSize = 50, resetKey: string = "") {
  const [page, setPage] = useState(1);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));

  useEffect(() => setPage(1), [resetKey]);

  const current = Math.min(page, pageCount);
  const pageItems = useMemo(
    () => items.slice((current - 1) * pageSize, current * pageSize),
    [items, current, pageSize],
  );

  return {
    page: current,
    pageCount,
    pageItems,
    setPage,
    from: items.length === 0 ? 0 : (current - 1) * pageSize + 1,
    to: Math.min(current * pageSize, items.length),
    total: items.length,
  };
}
