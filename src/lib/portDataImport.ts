// Parses a shipping line's port list (Excel) into container_port_data rows.
// No UI or database access here, so the whole import path is unit-tested.
//
// Lines send these lists in their own layouts. WOM's, for example, has
// "Container Id | Size | Vessel Arrival Date | Free Days" and no line column at
// all, because the whole file is WOM's. So the line can come from the file or
// from the line the user picked for it.

import * as XLSX from "xlsx";
import { CONTAINER_NUMBER_REGEX } from "@/lib/validation";
import { CONTAINER_TYPE_CODES } from "@/lib/containerTypes";
import { SHIPPING_LINES } from "@/lib/shippingLines";
import { DEMURRAGE_RULES, hasDemurrageRules } from "@/lib/demurrage";

export type SpreadsheetRow = Record<string, unknown>;

/** One spreadsheet row with its Excel row number (1-based, as Excel shows it). */
export interface SheetRow {
  rowNumber: number;
  values: SpreadsheetRow;
}

export interface ParsedPortRecord {
  rowNumber: number;
  container_number: string;
  shipping_line: string;
  container_type: string | null;
  port_arrival_date: string;
  free_days: number;
  /** True when the file had no usable free days and the line's standard was used. */
  freeDaysDefaulted: boolean;
}

export interface RowIssue {
  rowNumber: number;
  containerNumber?: string;
  message: string;
}

export interface PortListParse {
  /** One record per container; a container listed twice keeps its last row. */
  records: ParsedPortRecord[];
  errors: RowIssue[];
  /** Containers listed more than once in the file. */
  duplicates: string[];
  /** Rows with no container number at all (blank lines, totals rows). */
  skippedBlankRows: number;
}

export interface ParseOptions {
  /** Line for rows with no line column or an empty line cell. */
  defaultLine: string | null;
  /** Line reps may only import their own line. */
  lockedLine?: string | null;
}

export const normalizeHeader = (header: string) =>
  header.toLowerCase().replace(/[^a-z0-9]/g, "");

export const HEADER_ALIASES = {
  containerNumber: ["containernumber", "container", "containerno", "containerid", "containernum", "cntr", "cntrno"],
  // "containertype" and "type" hold full codes ("40HC") or a suffix ("HC");
  // "size" holds the length ("40", "20").
  containerType: ["containertype", "type", "containersize", "sizetype"],
  containerSize: ["size"],
  shippingLine: ["shippingline", "line", "shipping", "carrier"],
  portArrivalDate: ["portarrivaldate", "arrivaldate", "portdate", "arrival", "vesselarrivaldate", "vesselarrival", "ata"],
  freeDays: ["freedays", "free", "daysfree", "freetime"],
} as const;

// Maps common full carrier names (lowercase substrings) to their internal codes.
// Used when the "Line" column contains the full company name instead of the code.
const SHIPPING_LINE_NAME_MAP: Record<string, string> = {
  "sea legend": "SLG",
  "sea lead": "SLD",
  "sealead": "SLD",
  "swift flow": "SFT",
  "swiftflow": "SFT",
  "sea falcon": "SFT",
  "seafalcon": "SFT",
  "medkon": "MDK",
  "baltrans": "BLT",
  "baltic": "BLT",
};

export const resolveShippingLine = (raw: string): string => {
  const trimmed = raw.trim();
  const upper = trimmed.toUpperCase();
  const exact = (SHIPPING_LINES as readonly string[]).find((code) => code.toUpperCase() === upper);
  if (exact) return exact;
  const lower = trimmed.toLowerCase();
  for (const [name, code] of Object.entries(SHIPPING_LINE_NAME_MAP)) {
    if (lower.includes(name)) return code;
  }
  // Try to find any known code as a word-boundary token inside the string
  for (const code of SHIPPING_LINES) {
    const re = new RegExp(`\\b${code}\\b`, "i");
    if (re.test(trimmed)) return code;
  }
  return upper;
};

export const getCellByAliases = (row: SpreadsheetRow, aliases: readonly string[]) => {
  for (const [key, value] of Object.entries(row)) {
    if (aliases.includes(normalizeHeader(key))) return value;
  }
  return undefined;
};

const isBlank = (value: unknown) => value == null || String(value).trim() === "";

// ISO 6346 group codes for the suffix a line might write after the length.
const TYPE_SUFFIXES: Record<string, string> = {
  "": "GP", GP: "GP", DV: "GP", DC: "GP", SD: "GP", ST: "GP", STD: "GP", DRY: "GP", G1: "GP",
  HC: "HC", HQ: "HC", HIGHCUBE: "HC", DH: "HC",
  RF: "RF", RE: "RF", REEFER: "RF", RT: "RF",
  RH: "RH", REEFERHC: "RH", HR: "RH",
  FR: "FR", FLATRACK: "FR",
  OT: "OT", OPENTOP: "OT",
  TK: "TK", TANK: "TK",
};

/**
 * Maps a size/type value to one of the app's ISO codes: "20" → 20GP,
 * "40" → 40GP, "40HC" / "40 HQ" → 40HC, "45" → 45HC. A plain length is a
 * standard dry box. Null when there is no 20/40/45 length to go on.
 */
export const toIsoContainerType = (value: unknown): string | null => {
  if (value == null) return null;
  const normalized = String(value).toUpperCase().replace(/[^A-Z0-9]/g, "");
  const length = normalized.slice(0, 2);
  if (!["20", "40", "45"].includes(length)) return null;
  if (length === "45") return "45HC";
  const suffix = normalized.slice(2).replace(/^(FT|FEET|FOOT)/, "");
  const code = `${length}${TYPE_SUFFIXES[suffix] ?? "GP"}`;
  return CONTAINER_TYPE_CODES.includes(code) ? code : `${length}GP`;
};

// Resolve the type from a row that may have separate "Size" and "Container Type"
// columns: Size="40" + Type="HC" → 40HC; Type="40HC" alone → 40HC; Size=20 → 20GP.
export const resolveContainerType = (row: SpreadsheetRow): string | null => {
  const typeVal = getCellByAliases(row, HEADER_ALIASES.containerType);
  const sizeVal = getCellByAliases(row, HEADER_ALIASES.containerSize);
  if (!isBlank(typeVal)) {
    const own = toIsoContainerType(typeVal);
    if (own) return own; // the type column already carries the length
    if (!isBlank(sizeVal)) return toIsoContainerType(`${String(sizeVal).trim()}${String(typeVal).trim()}`);
  }
  return isBlank(sizeVal) ? null : toIsoContainerType(sizeVal);
};

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

const toIsoDate = (y: number, m: number, d: number): string | null => {
  if (y < 100) y += 2000;
  // Round-trip through Date.UTC so 31/02 and similar are rejected.
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
};

/**
 * Reads an arrival date as YYYY-MM-DD. Handles Excel date cells and the text
 * forms lines type by hand. Numeric text dates are day-first (DD/MM/YYYY), the
 * way Jordan writes them, unless the second number can't be a month. Never
 * goes through `new Date(text)`, which can shift the day by the time zone.
 */
export function parseExcelDate(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return toIsoDate(value.getFullYear(), value.getMonth() + 1, value.getDate());
  }
  if (typeof value === "number") {
    const date = XLSX.SSF.parse_date_code(value);
    return date ? toIsoDate(date.y, date.m, date.d) : null;
  }
  const raw = String(value).trim();

  const iso = raw.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:$|[ T])/);
  if (iso) return toIsoDate(+iso[1], +iso[2], +iso[3]);

  const numeric = raw.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:$|\s)/);
  if (numeric) {
    const [a, b, y] = [+numeric[1], +numeric[2], +numeric[3]];
    return b > 12 ? toIsoDate(y, a, b) : toIsoDate(y, b, a);
  }

  // 20-Sep-2026, 20 Sep 2026, 20 September 2026
  const dayMonth = raw.match(/^(\d{1,2})[-\s/]([A-Za-z]{3,})[-\s/,]+(\d{2}|\d{4})$/);
  if (dayMonth) {
    const m = MONTHS[dayMonth[2].slice(0, 3).toLowerCase()];
    return m ? toIsoDate(+dayMonth[3], m, +dayMonth[1]) : null;
  }
  // Sep 20, 2026
  const monthDay = raw.match(/^([A-Za-z]{3,})[-\s/](\d{1,2}),?[-\s/]+(\d{2}|\d{4})$/);
  if (monthDay) {
    const m = MONTHS[monthDay[1].slice(0, 3).toLowerCase()];
    return m ? toIsoDate(+monthDay[3], m, +monthDay[2]) : null;
  }
  return null;
}

/**
 * Turns the first sheet into rows keyed by header. The header row is the first
 * of the top 20 rows that names a container column, so title rows above the
 * table are fine. Row numbers are the ones Excel shows.
 */
export function rowsFromSheet(sheet: XLSX.WorkSheet): SheetRow[] {
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: true, blankrows: true });
  const firstRow = sheet["!ref"] ? XLSX.utils.decode_range(sheet["!ref"]).s.r + 1 : 1;
  const headerIdx = grid
    .slice(0, 20)
    .findIndex((cells) =>
      (cells ?? []).some((c) => typeof c === "string" && (HEADER_ALIASES.containerNumber as readonly string[]).includes(normalizeHeader(c))),
    );
  if (headerIdx < 0) return [];
  const headers = (grid[headerIdx] ?? []).map((h, i) => (h == null || String(h).trim() === "" ? `__col${i}` : String(h)));
  return grid.slice(headerIdx + 1).map((cells, i) => ({
    rowNumber: firstRow + headerIdx + 1 + i,
    values: Object.fromEntries(headers.map((h, c) => [h, (cells ?? [])[c] ?? null])),
  }));
}

/** Validates each row and dedupes by container. Pure — no database access. */
export function parsePortRows(rows: SheetRow[], options: ParseOptions): PortListParse {
  const errors: RowIssue[] = [];
  const byContainer = new Map<string, ParsedPortRecord>();
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  let skippedBlankRows = 0;

  for (const { rowNumber, values } of rows) {
    const rawNumber = getCellByAliases(values, HEADER_ALIASES.containerNumber);
    if (isBlank(rawNumber)) {
      skippedBlankRows += 1;
      continue;
    }
    // Lines sometimes write "ZONU 024814-2"; the number is the letters and digits.
    const containerNumber = String(rawNumber).toUpperCase().replace(/[^A-Z0-9]/g, "");
    const issue = (message: string) => errors.push({ rowNumber, containerNumber, message });

    if (!CONTAINER_NUMBER_REGEX.test(containerNumber)) {
      issue(`"${String(rawNumber).trim()}" is not a container number (4 letters + 7 digits)`);
      continue;
    }

    const lineCell = getCellByAliases(values, HEADER_ALIASES.shippingLine);
    const shippingLine = isBlank(lineCell) ? options.defaultLine : resolveShippingLine(String(lineCell));
    if (!shippingLine) {
      issue("no shipping line — pick the line this file is for");
      continue;
    }
    if (!(SHIPPING_LINES as readonly string[]).includes(shippingLine)) {
      issue(`unrecognized shipping line "${shippingLine}" — expected one of: ${SHIPPING_LINES.join(", ")}`);
      continue;
    }
    if (options.lockedLine && shippingLine !== options.lockedLine) {
      issue(`you can only import ${options.lockedLine} containers — this row is ${shippingLine}`);
      continue;
    }
    if (!hasDemurrageRules(shippingLine)) {
      issue(`${shippingLine} isn't charged demurrage, so it needs no port data`);
      continue;
    }

    const arrivalRaw = getCellByAliases(values, HEADER_ALIASES.portArrivalDate);
    const portArrivalDate = parseExcelDate(arrivalRaw);
    if (!portArrivalDate) {
      issue(isBlank(arrivalRaw) ? "missing port arrival date" : `unreadable port arrival date "${String(arrivalRaw)}"`);
      continue;
    }

    const freeRaw = getCellByAliases(values, HEADER_ALIASES.freeDays);
    // "21", 21, "21 days"
    const freeMatch = isBlank(freeRaw) ? null : /^(\d+)(?:\.0+)?\s*(?:days?)?$/i.exec(String(freeRaw).trim());
    const freeParsed = freeMatch ? Number(freeMatch[1]) : Number.NaN;
    const freeValid = Number.isInteger(freeParsed) && freeParsed >= 0 && freeParsed <= 365;
    if (!isBlank(freeRaw) && !freeValid) {
      issue(`free days "${String(freeRaw)}" must be a whole number from 0 to 365`);
      continue;
    }

    if (seen.has(containerNumber)) duplicates.add(containerNumber);
    seen.add(containerNumber);
    byContainer.set(containerNumber, {
      rowNumber,
      container_number: containerNumber,
      shipping_line: shippingLine,
      container_type: resolveContainerType(values),
      port_arrival_date: portArrivalDate,
      free_days: freeValid ? freeParsed : DEMURRAGE_RULES[shippingLine].freeDays,
      freeDaysDefaulted: !freeValid,
    });
  }

  return {
    records: Array.from(byContainer.values()),
    errors,
    duplicates: Array.from(duplicates),
    skippedBlankRows,
  };
}
