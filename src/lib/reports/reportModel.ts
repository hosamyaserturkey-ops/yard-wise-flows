// Library-neutral description of an exported report. The builders in
// reportData.ts produce it from plain rows, and workbook.ts renders it with
// ExcelJS — so every number in a report can be unit-tested without touching
// Excel or Supabase.

export type CellValue = string | number | Date | null;

/** How a column's values are shown. */
export type ColumnFormat =
  | "text"
  | "int"
  | "decimal1"
  | "money"
  | "date"
  | "datetime";

/** What the totals row shows under a column. */
export type ColumnTotal = "sum" | "count" | "average" | "label";

export interface ReportColumn {
  key: string;
  header: string;
  /** Excel column width in characters. */
  width: number;
  format?: ColumnFormat;
  total?: ColumnTotal;
}

export interface ReportTable {
  /** Heading printed above the table. Omitted for a sheet's main table. */
  title?: string;
  columns: ReportColumn[];
  rows: Record<string, CellValue>[];
  /** Adds a totals row under the table. */
  totals?: boolean;
  /** Shown under the table in small italic text. */
  note?: string;
  /** Column key whose day counts get colour-banded by age. */
  ageColumnKey?: string;
}

export interface ReportKpi {
  label: string;
  value: number | string;
  format?: ColumnFormat;
}

export interface ReportSheet {
  name: string;
  kpis?: ReportKpi[];
  tables: ReportTable[];
  /**
   * A detail sheet holds a single long table: its header freezes, it gets a
   * filter dropdown on every column, and its header repeats on each printed page.
   */
  detail?: boolean;
}

export interface ReportSpec {
  /** e.g. "In-Yard Stock Report". */
  title: string;
  /** Label/value pairs printed under the title (yard, period, filters…). */
  meta: [string, string][];
  sheets: ReportSheet[];
  fileName: string;
}
