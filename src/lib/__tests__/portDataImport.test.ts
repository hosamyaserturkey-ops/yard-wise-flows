import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";

// shippingLines.ts pulls in the Supabase client, which needs a browser.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import {
  excelDatesLookMonthFirst,
  parseExcelDate,
  parsePortRows,
  resolveContainerType,
  rowsFromSheet,
  toIsoContainerType,
  type SheetRow,
} from "../portDataImport";

// Excel serial for a calendar date (1900 date system).
const serial = (iso: string) => (Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) - Date.UTC(1899, 11, 30)) / 86400000;

// Same layout as WOM's list: an unlabeled "#" column, no line column, computed
// columns the import ignores (one with an Arabic header).
const womSheet = () =>
  XLSX.utils.aoa_to_sheet([
    [null, "Container Id", "Size", "Vessel Arrival Date", "Free Days", "Last Free Day / Date", "today", "عدد أيام الأعطال المستحقه", "Demurrage amount ( USD) "],
    [1, "ZONU0248142", 20, serial("2026-09-20"), 21, serial("2026-10-10"), serial("2026-10-01"), -9, -450],
    [2, "CLHU3405663", 20, serial("2026-09-20"), 21, serial("2026-10-10"), serial("2026-10-01"), -9, -450],
    [3, "TEMU4267243", 20, serial("2026-09-12"), 21, serial("2026-10-02"), serial("2026-10-01"), -1, -50],
  ]);

const row = (rowNumber: number, values: Record<string, unknown>): SheetRow => ({ rowNumber, values });

describe("WOM port list", () => {
  it("imports every row once WOM is picked for the file", () => {
    const parsed = parsePortRows(rowsFromSheet(womSheet()), { defaultLine: "WOM" });
    expect(parsed.errors).toEqual([]);
    expect(parsed.records).toEqual([
      expect.objectContaining({ rowNumber: 2, container_number: "ZONU0248142", shipping_line: "WOM", container_type: "20GP", port_arrival_date: "2026-09-20", free_days: 21, freeDaysDefaulted: false }),
      expect.objectContaining({ rowNumber: 3, container_number: "CLHU3405663", port_arrival_date: "2026-09-20" }),
      expect.objectContaining({ rowNumber: 4, container_number: "TEMU4267243", port_arrival_date: "2026-09-12" }),
    ]);
  });

  it("rejects every row when no line is picked (the old behaviour)", () => {
    const parsed = parsePortRows(rowsFromSheet(womSheet()), { defaultLine: null });
    expect(parsed.records).toEqual([]);
    expect(parsed.errors).toHaveLength(3);
    expect(parsed.errors[0].message).toMatch(/pick the line/);
  });
});

describe("rowsFromSheet", () => {
  it("finds the header below title rows and keeps Excel row numbers", () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["WOM demurrage list"],
      [],
      ["Container No", "Size", "Arrival Date"],
      ["ZONU0248142", "40HC", "20/09/2026"],
    ]);
    const rows = rowsFromSheet(sheet);
    expect(rows).toHaveLength(1);
    expect(rows[0].rowNumber).toBe(4);
    expect(rows[0].values["Container No"]).toBe("ZONU0248142");
  });

  it("returns nothing when no column names a container", () => {
    expect(rowsFromSheet(XLSX.utils.aoa_to_sheet([["a", "b"], [1, 2]]))).toEqual([]);
  });
});

describe("parsePortRows", () => {
  const base = { "Container Id": "ZONU0248142", Size: 20, "Vessel Arrival Date": "2026-09-20", "Free Days": 21 };

  it("prefers the file's line column over the picked line", () => {
    const parsed = parsePortRows([row(2, { ...base, Line: "Sea Lead Shipping" })], { defaultLine: "WOM" });
    expect(parsed.records[0].shipping_line).toBe("SLD");
  });

  it("stops line reps importing another line", () => {
    const parsed = parsePortRows([row(2, { ...base, Line: "SLG" })], { defaultLine: "WOM", lockedLine: "WOM" });
    expect(parsed.records).toEqual([]);
    expect(parsed.errors[0].message).toMatch(/only import WOM/);
  });

  it("skips lines that aren't charged demurrage", () => {
    const parsed = parsePortRows([row(2, { ...base, Line: "7seas" })], { defaultLine: null });
    expect(parsed.errors[0].message).toMatch(/7Seas isn't charged/);
  });

  it("keeps the file's free days, including ones that differ from the line's standard", () => {
    const parsed = parsePortRows([row(2, { ...base, "Free Days": "30 days" })], { defaultLine: "WOM" });
    expect(parsed.records[0].free_days).toBe(30);
    expect(parsed.records[0].freeDaysDefaulted).toBe(false);
  });

  it("uses the line's standard free days when the file has none", () => {
    const { "Free Days": _omit, ...noFree } = base;
    const parsed = parsePortRows([row(2, noFree)], { defaultLine: "WOM" });
    expect(parsed.records[0].free_days).toBe(21);
    expect(parsed.records[0].freeDaysDefaulted).toBe(true);
  });

  it("rejects free days that aren't a whole number of days", () => {
    for (const bad of ["-2", "abc", "2.5", 400]) {
      const parsed = parsePortRows([row(2, { ...base, "Free Days": bad })], { defaultLine: "WOM" });
      expect(parsed.records).toEqual([]);
      expect(parsed.errors[0].message).toMatch(/free days/);
    }
  });

  it("cleans spaces and dashes out of container numbers", () => {
    const parsed = parsePortRows([row(2, { ...base, "Container Id": " zonu 024814-2 " })], { defaultLine: "WOM" });
    expect(parsed.records[0].container_number).toBe("ZONU0248142");
  });

  it("reports malformed container numbers and missing dates", () => {
    const parsed = parsePortRows(
      [
        row(2, { ...base, "Container Id": "ZONU02481" }),
        row(3, { ...base, "Vessel Arrival Date": null }),
        row(4, { ...base, "Vessel Arrival Date": "soon" }),
      ],
      { defaultLine: "WOM" },
    );
    expect(parsed.errors.map((e) => [e.rowNumber, e.message])).toEqual([
      [2, expect.stringMatching(/not a container number/)],
      [3, "missing port arrival date"],
      [4, 'unreadable port arrival date "soon"'],
    ]);
  });

  it("skips blank and totals rows without reporting them as errors", () => {
    const parsed = parsePortRows(
      [row(2, base), row(3, { "Container Id": null }), row(4, { "Container Id": "", "Demurrage amount": 900 })],
      { defaultLine: "WOM" },
    );
    expect(parsed.errors).toEqual([]);
    expect(parsed.skippedBlankRows).toBe(2);
  });

  it("keeps the last row for a container listed twice and reports it", () => {
    const parsed = parsePortRows(
      [row(2, base), row(3, { ...base, "Vessel Arrival Date": "2026-09-12" })],
      { defaultLine: "WOM" },
    );
    expect(parsed.records).toHaveLength(1);
    expect(parsed.records[0]).toMatchObject({ rowNumber: 3, port_arrival_date: "2026-09-12" });
    expect(parsed.duplicates).toEqual(["ZONU0248142"]);
  });
});

describe("toIsoContainerType / resolveContainerType", () => {
  it("maps a bare length to that length's standard box", () => {
    expect(toIsoContainerType(20)).toBe("20GP");
    expect(toIsoContainerType("20'")).toBe("20GP");
    expect(toIsoContainerType("20FT")).toBe("20GP");
    expect(toIsoContainerType(40)).toBe("40HC");
    expect(toIsoContainerType("40")).toBe("40HC");
    expect(toIsoContainerType("40'")).toBe("40HC");
    expect(toIsoContainerType("40 FT")).toBe("40HC");
    expect(toIsoContainerType("45")).toBe("45HC");
  });

  it("keeps the type group", () => {
    expect(toIsoContainerType("40GP")).toBe("40GP");
    expect(toIsoContainerType("40HC")).toBe("40HC");
    expect(toIsoContainerType("40 HQ")).toBe("40HC");
    expect(toIsoContainerType("40' high cube")).toBe("40HC");
    expect(toIsoContainerType("20RF")).toBe("20RF");
    expect(toIsoContainerType("40DV")).toBe("40GP");
    expect(toIsoContainerType("20RH")).toBe("20GP"); // no 20ft reefer high cube code
  });

  it("returns null without a length", () => {
    expect(toIsoContainerType("HC")).toBeNull();
    expect(toIsoContainerType("")).toBeNull();
    expect(toIsoContainerType(null)).toBeNull();
  });

  it("combines separate size and type columns", () => {
    expect(resolveContainerType({ Size: 40, Type: "HC" })).toBe("40HC");
    expect(resolveContainerType({ Size: 40, Type: "GP" })).toBe("40GP");
    expect(resolveContainerType({ Size: "40", "Container Type": "40HC" })).toBe("40HC");
    expect(resolveContainerType({ Size: 40 })).toBe("40HC");
    expect(resolveContainerType({ Size: 20 })).toBe("20GP");
    expect(resolveContainerType({ Type: "HC" })).toBeNull();
    expect(resolveContainerType({})).toBeNull();
  });
});

describe("parseExcelDate", () => {
  it("reads Excel date cells", () => {
    expect(parseExcelDate(serial("2026-09-20"))).toBe("2026-09-20");
    expect(parseExcelDate(serial("2026-09-20") + 0.75)).toBe("2026-09-20");
  });

  it("reads day-first text dates", () => {
    expect(parseExcelDate("20/09/2026")).toBe("2026-09-20");
    expect(parseExcelDate("05-09-2026")).toBe("2026-09-05");
    expect(parseExcelDate("5.9.26")).toBe("2026-09-05");
  });

  it("never guesses month-first: 9/11 is 9 Nov and 9/20 is unreadable", () => {
    expect(parseExcelDate("9/11/2026")).toBe("2026-11-09");
    expect(parseExcelDate("9/20/2026")).toBeNull();
  });

  it("swaps day and month back on Excel dates when told Excel read them month-first", () => {
    const opts = { excelDatesMonthFirst: true };
    expect(parseExcelDate(serial("2026-09-11"), opts)).toBe("2026-11-09");
    // A day after the 12th can't be a typed month, so Excel's date stands.
    expect(parseExcelDate(serial("2026-09-25"), opts)).toBe("2026-09-25");
    // Text is DD/MM/YYYY either way.
    expect(parseExcelDate("14/11/2026", opts)).toBe("2026-11-14");
  });

  it("reads ISO and month-name dates without shifting the day", () => {
    expect(parseExcelDate("2026-09-20")).toBe("2026-09-20");
    expect(parseExcelDate("2026-09-20T00:00:00")).toBe("2026-09-20");
    expect(parseExcelDate("20-Sep-2026")).toBe("2026-09-20");
    expect(parseExcelDate("20 September 2026")).toBe("2026-09-20");
    expect(parseExcelDate("Sep 20, 2026")).toBe("2026-09-20");
  });

  it("reads Date objects by their local calendar day", () => {
    expect(parseExcelDate(new Date(2026, 8, 20, 0, 0))).toBe("2026-09-20");
  });

  it("rejects impossible or unreadable dates", () => {
    expect(parseExcelDate("31/02/2026")).toBeNull();
    expect(parseExcelDate("13/13/2026")).toBeNull();
    expect(parseExcelDate("next week")).toBeNull();
    expect(parseExcelDate("")).toBeNull();
    expect(parseExcelDate(null)).toBeNull();
  });
});

// A day-first list saved by an Excel set to month-first dates: "14/11/2026"
// stays text (14 can't be a month), "9/11/2026" becomes the date 11 Sep.
describe("day-first file from a month-first Excel", () => {
  const usExcelDate = (iso: string) => ({ t: "n", v: serial(iso), z: "m/d/yyyy" });
  const eelSheet = () => {
    const sheet = XLSX.utils.aoa_to_sheet([
      ["B/L", "Container", "Line", "Port Arrival Date"],
      ["CPISOKAQJ198427", "YMLU3388300", "EEL", "14/11/2026"],
      ["CPISOKAQJ192727", "TGHU9822567", "EEL", "14/11/2026"],
      ["CPISOKAQJ193627", "FSCU9765704", "EEL", usExcelDate("2026-09-11")],
      ["CPISOKAQJ193827", "GLDU7644860", "EEL", usExcelDate("2026-09-11")],
    ]);
    // Round-trip through a real .xlsx, as the upload does.
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, "Sheet1");
    const read = XLSX.read(XLSX.write(book, { type: "array", bookType: "xlsx" }));
    return read.Sheets[read.SheetNames[0]];
  };

  it("reads 9/11/2026 as 9 Nov, not the 11 Sep Excel stored", () => {
    const parsed = parsePortRows(rowsFromSheet(eelSheet()), { defaultLine: "EEL" });
    expect(parsed.errors).toEqual([]);
    expect(parsed.records.map((r) => [r.container_number, r.port_arrival_date, r.excelArrivalDate])).toEqual([
      ["YMLU3388300", "2026-11-14", undefined],
      ["TGHU9822567", "2026-11-14", undefined],
      ["FSCU9765704", "2026-11-09", "2026-09-11"],
      ["GLDU7644860", "2026-11-09", "2026-09-11"],
    ]);
  });

  it("trusts Excel's dates when nothing in the column says otherwise", () => {
    // A day-first Excel stores 9/11/2026 as 9 Nov; no text dates beside it.
    const parsed = parsePortRows([row(2, { Container: "FSCU9765704", Line: "EEL", "Port Arrival Date": serial("2026-11-09") })], {
      defaultLine: "EEL",
    });
    expect(parsed.records[0].port_arrival_date).toBe("2026-11-09");
    expect(parsed.records[0].excelArrivalDate).toBeUndefined();
  });

  it("only flags the mix of Excel dates and text that has to be day-first", () => {
    expect(excelDatesLookMonthFirst(["14/11/2026", serial("2026-09-11")])).toBe(true);
    expect(excelDatesLookMonthFirst(["09/11/2026", serial("2026-09-11")])).toBe(false);
    expect(excelDatesLookMonthFirst(["14/11/2026", "9/11/2026"])).toBe(false);
    expect(excelDatesLookMonthFirst([serial("2026-09-11")])).toBe(false);
  });

  it("explains that unreadable numeric dates are read DD/MM/YYYY", () => {
    const parsed = parsePortRows([row(2, { Container: "FSCU9765704", Line: "EEL", "Port Arrival Date": "11/14/2026" })], {
      defaultLine: "EEL",
    });
    expect(parsed.errors[0].message).toBe('unreadable port arrival date "11/14/2026" — dates are read as DD/MM/YYYY');
  });
});
