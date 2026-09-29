const PAGE = 1000;

/**
 * The API returns at most one page of rows per request, so a single select
 * would silently drop the oldest rows once a table grows — and every total
 * built on it would be wrong. Page through all of them.
 */
export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) return rows;
  }
}
