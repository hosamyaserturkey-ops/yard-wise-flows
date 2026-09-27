// Renders a ReportSpec to a styled .xlsx with ExcelJS.
//
// Import this module lazily (`await import(...)`): ExcelJS is large and only
// needed at the moment someone exports, so it stays out of the main bundle.

import ExcelJS from "exceljs";
import type {
  CellValue,
  ColumnFormat,
  ReportColumn,
  ReportKpi,
  ReportSheet,
  ReportSpec,
  ReportTable,
} from "./reportModel";

const FONT = "Arial";
const NAVY = "FF1F3864";
const NAVY_TINT = "FFDCE3F0";
const ZEBRA = "FFF2F2F2";
const GRID = "FFD9D9D9";
const MUTED = "FF595959";

const NUM_FMT: Record<ColumnFormat, string | undefined> = {
  text: undefined,
  int: "#,##0",
  decimal1: "#,##0.0",
  money: "#,##0.000",
  date: "dd-mmm-yyyy",
  datetime: "dd-mmm-yyyy hh:mm",
};

const thin = { style: "thin" as const, color: { argb: GRID } };
const BORDER = { top: thin, left: thin, bottom: thin, right: thin };
const fill = (argb: string): ExcelJS.Fill => ({ type: "pattern", pattern: "solid", fgColor: { argb } });

/**
 * ExcelJS stores a Date as its UTC instant, so a 14:24 gate-in in Amman would
 * read 11:24 in Excel. Shift by the local offset so the sheet shows the same
 * wall-clock time the app does.
 */
export function toExcelLocal(d: Date): Date {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000);
}

const excelValue = (v: CellValue): ExcelJS.CellValue =>
  v instanceof Date ? toExcelLocal(v) : v;

/** Header/footer text treats "&" as a control character. */
const hfEscape = (s: string) => s.replace(/&/g, "&&");

function numericValues(rows: Record<string, CellValue>[], key: string): number[] {
  return rows.map((r) => r[key]).filter((v): v is number => typeof v === "number");
}

function totalFor(col: ReportColumn, rows: Record<string, CellValue>[], range: string): ExcelJS.CellValue {
  switch (col.total) {
    case "sum": {
      const result = numericValues(rows, col.key).reduce((a, b) => a + b, 0);
      return { formula: `SUBTOTAL(109,${range})`, result: Math.round(result * 1000) / 1000 };
    }
    case "count":
      return {
        formula: `SUBTOTAL(103,${range})`,
        result: rows.filter((r) => r[col.key] != null && r[col.key] !== "").length,
      };
    case "average": {
      const nums = numericValues(rows, col.key);
      const result = nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0;
      // IFERROR: an average over a filtered-to-nothing range would be #DIV/0!.
      return { formula: `IFERROR(SUBTOTAL(101,${range}),0)`, result: Math.round(result * 10) / 10 };
    }
    case "label":
      return "Total";
    default:
      return null;
  }
}

/** Writes the title block; returns the next free row. */
function writeTitle(ws: ExcelJS.Worksheet, spec: ReportSpec, sheet: ReportSheet, span: number): number {
  const last = Math.max(span, 4);
  ws.mergeCells(1, 1, 1, last);
  const title = ws.getCell(1, 1);
  title.value = sheet.name === "Summary" ? spec.title : `${spec.title} — ${sheet.name}`;
  title.font = { name: FONT, size: 16, bold: true, color: { argb: NAVY } };
  ws.getRow(1).height = 24;

  ws.mergeCells(2, 1, 2, last);
  const meta = ws.getCell(2, 1);
  meta.value = spec.meta.map(([k, v]) => `${k}: ${v}`).join("   |   ");
  meta.font = { name: FONT, size: 9, color: { argb: MUTED } };
  meta.alignment = { wrapText: true, vertical: "top" };
  ws.getRow(2).height = 28;
  return 4;
}

function writeKpis(ws: ExcelJS.Worksheet, kpis: ReportKpi[], startRow: number): number {
  const heading = ws.getCell(startRow, 1);
  heading.value = "Key figures";
  heading.font = { name: FONT, size: 12, bold: true, color: { argb: NAVY } };
  let r = startRow + 1;
  for (const k of kpis) {
    ws.mergeCells(r, 1, r, 3);
    const label = ws.getCell(r, 1);
    label.value = k.label;
    label.font = { name: FONT, size: 10 };
    label.fill = fill(NAVY_TINT);
    label.border = BORDER;
    const value = ws.getCell(r, 4);
    value.value = k.value;
    value.font = { name: FONT, size: 11, bold: true };
    value.border = BORDER;
    value.alignment = { horizontal: "right" };
    const fmt = k.format && NUM_FMT[k.format];
    if (fmt) value.numFmt = fmt;
    r += 1;
  }
  return r + 1;
}

interface WrittenTable {
  headerRow: number;
  firstDataRow: number;
  lastDataRow: number;
  nextRow: number;
}

function writeTable(ws: ExcelJS.Worksheet, table: ReportTable, startRow: number): WrittenTable {
  let r = startRow;
  if (table.title) {
    const t = ws.getCell(r, 1);
    t.value = table.title;
    t.font = { name: FONT, size: 12, bold: true, color: { argb: NAVY } };
    r += 1;
  }

  const headerRow = r;
  table.columns.forEach((col, i) => {
    const c = ws.getCell(r, i + 1);
    c.value = col.header;
    c.font = { name: FONT, size: 10, bold: true, color: { argb: "FFFFFFFF" } };
    c.fill = fill(NAVY);
    c.border = BORDER;
    c.alignment = { vertical: "middle", horizontal: col.format && col.format !== "text" ? "center" : "left", wrapText: true };
  });
  ws.getRow(r).height = 20;
  r += 1;

  const firstDataRow = r;
  if (table.rows.length === 0) {
    ws.mergeCells(r, 1, r, table.columns.length);
    const c = ws.getCell(r, 1);
    c.value = "No records for this selection.";
    c.font = { name: FONT, size: 10, italic: true, color: { argb: MUTED } };
    return { headerRow, firstDataRow, lastDataRow: r - 1, nextRow: r + 2 };
  }

  table.rows.forEach((row, idx) => {
    table.columns.forEach((col, i) => {
      const c = ws.getCell(r, i + 1);
      c.value = excelValue(row[col.key] ?? null);
      c.font = { name: FONT, size: 10 };
      c.border = BORDER;
      const fmt = col.format && NUM_FMT[col.format];
      if (fmt) c.numFmt = fmt;
      if (idx % 2 === 1) c.fill = fill(ZEBRA);
    });
    r += 1;
  });
  const lastDataRow = r - 1;

  if (table.totals) {
    table.columns.forEach((col, i) => {
      const letter = ws.getColumn(i + 1).letter;
      const c = ws.getCell(r, i + 1);
      c.value = totalFor(col, table.rows, `${letter}${firstDataRow}:${letter}${lastDataRow}`);
      c.font = { name: FONT, size: 10, bold: true };
      c.fill = fill(NAVY_TINT);
      c.border = { ...BORDER, top: { style: "double", color: { argb: NAVY } } };
      const fmt =
        col.total === "average" ? NUM_FMT.decimal1 : col.total === "count" ? NUM_FMT.int : col.format && NUM_FMT[col.format];
      if (fmt && col.total !== "label") c.numFmt = fmt;
    });
    r += 1;
  }

  if (table.ageColumnKey) {
    const idx = table.columns.findIndex((c) => c.key === table.ageColumnKey);
    if (idx >= 0) {
      const letter = ws.getColumn(idx + 1).letter;
      const band = (priority: number, formulae: number[], operator: "greaterThan" | "between", argb: string, bold = false) => ({
        type: "cellIs" as const,
        operator,
        formulae,
        priority,
        style: { fill: fill(argb), font: { name: FONT, bold, color: { argb: "FF000000" } } },
      });
      ws.addConditionalFormatting({
        ref: `${letter}${firstDataRow}:${letter}${lastDataRow}`,
        rules: [
          band(1, [30], "greaterThan", "FFF4B6B6", true),
          band(2, [22, 30], "between", "FFF8CBAD"),
          band(3, [15, 21], "between", "FFFFE699"),
        ],
      });
    }
  }

  if (table.note) {
    const n = ws.getCell(r, 1);
    n.value = table.note;
    n.font = { name: FONT, size: 9, italic: true, color: { argb: MUTED } };
    r += 1;
  }

  return { headerRow, firstDataRow, lastDataRow, nextRow: r + 1 };
}

function setColumnWidths(ws: ExcelJS.Worksheet, sheet: ReportSheet) {
  const widths: number[] = [];
  for (const t of sheet.tables) {
    t.columns.forEach((c, i) => {
      widths[i] = Math.max(widths[i] ?? 0, c.width);
    });
  }
  // KPI labels span A:C and values sit in D.
  if (sheet.kpis?.length) widths[3] = Math.max(widths[3] ?? 0, 16);
  widths.forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });
}

function writeSheet(wb: ExcelJS.Workbook, spec: ReportSpec, sheet: ReportSheet) {
  const ws = wb.addWorksheet(sheet.name, {
    properties: { tabColor: { argb: sheet.detail ? "FF2E75B6" : NAVY } },
    pageSetup: {
      paperSize: 9, // A4
      orientation: "landscape",
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 0,
      margins: { left: 0.4, right: 0.4, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 },
    },
  });
  ws.headerFooter.oddFooter = `&L&8${hfEscape(spec.title)}&C&8Page &P of &N&R&8${hfEscape(
    spec.meta.find(([k]) => k === "Generated")?.[1] ?? "",
  )}`;

  setColumnWidths(ws, sheet);
  const span = Math.max(...sheet.tables.map((t) => t.columns.length), 4);
  let row = writeTitle(ws, spec, sheet, span);
  if (sheet.kpis?.length) row = writeKpis(ws, sheet.kpis, row);

  for (const table of sheet.tables) {
    const written = writeTable(ws, table, row);
    if (sheet.detail) {
      ws.views = [{ state: "frozen", xSplit: 0, ySplit: written.headerRow, showGridLines: false }];
      if (written.lastDataRow >= written.firstDataRow) {
        ws.autoFilter = {
          from: { row: written.headerRow, column: 1 },
          to: { row: written.lastDataRow, column: table.columns.length },
        };
      }
      ws.pageSetup.printTitlesRow = `${written.headerRow}:${written.headerRow}`;
    }
    row = written.nextRow;
  }
  if (!sheet.detail) ws.views = [{ showGridLines: false }];
}

export function renderWorkbook(spec: ReportSpec): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = spec.meta.find(([k]) => k === "Generated")?.[1]?.split(" by ")[1] ?? "Yard system";
  wb.title = spec.title;
  wb.created = new Date();
  for (const sheet of spec.sheets) writeSheet(wb, spec, sheet);
  return wb;
}

/** Builds the workbook and hands it to the browser as a download. */
export async function downloadReport(spec: ReportSpec): Promise<void> {
  const buffer = await renderWorkbook(spec).xlsx.writeBuffer();
  const blob = new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = spec.fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
