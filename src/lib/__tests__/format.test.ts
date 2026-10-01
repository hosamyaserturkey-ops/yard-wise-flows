import { describe, expect, it } from "vitest";
import {
  formatDate,
  formatDateTime,
  formatMonthYear,
  formatTime,
  formatWeekdayDate,
  parseDateInput,
  toDate,
} from "../format";

describe("formatDate", () => {
  it("prints day, short month and year", () => {
    expect(formatDate(new Date(2026, 9, 1))).toBe("01 Oct 2026");
    expect(formatDate(new Date(2026, 8, 30))).toBe("30 Sep 2026");
  });
  it("reads a bare YYYY-MM-DD as that local day", () => {
    expect(formatDate("2026-10-01")).toBe("01 Oct 2026");
  });
  it("accepts ISO timestamps", () => {
    const d = new Date(2026, 6, 23, 14, 5);
    expect(formatDate(d.toISOString())).toBe("23 Jul 2026");
  });
  it("returns a dash for invalid input", () => {
    expect(formatDate("not a date")).toBe("—");
  });
});

describe("formatTime / formatDateTime", () => {
  it("uses 24-hour time", () => {
    const d = new Date(2026, 9, 1, 22, 7);
    expect(formatTime(d)).toBe("22:07");
    expect(formatDateTime(d)).toBe("01 Oct 2026, 22:07");
  });
  it("pads early hours", () => {
    expect(formatTime(new Date(2026, 0, 1, 3, 4))).toBe("03:04");
  });
});

describe("formatWeekdayDate / formatMonthYear", () => {
  it("prints weekday labels", () => {
    expect(formatWeekdayDate("2026-10-01")).toBe("Thu, 01 Oct 2026");
    expect(formatWeekdayDate("2026-10-01", false)).toBe("Thu, 01 Oct");
  });
  it("prints month labels", () => {
    expect(formatMonthYear("2026-09-01")).toBe("September 2026");
  });
});

describe("parseDateInput", () => {
  it("reads day-first numeric dates", () => {
    expect(parseDateInput("01/10/2026")).toBe("2026-10-01");
    expect(parseDateInput("1/10/2026")).toBe("2026-10-01");
    expect(parseDateInput("01-10-2026")).toBe("2026-10-01");
    expect(parseDateInput("01.10.2026")).toBe("2026-10-01");
    expect(parseDateInput("1/10/26")).toBe("2026-10-01");
    expect(parseDateInput("01102026")).toBe("2026-10-01");
  });
  it("reads month names", () => {
    expect(parseDateInput("01 Oct 2026")).toBe("2026-10-01");
    expect(parseDateInput("1 october 2026")).toBe("2026-10-01");
    expect(parseDateInput("30 Sept 2026")).toBe("2026-09-30");
  });
  it("reads ISO dates", () => {
    expect(parseDateInput("2026-10-01")).toBe("2026-10-01");
  });
  it("rejects impossible or partial dates", () => {
    expect(parseDateInput("31/02/2026")).toBeNull();
    expect(parseDateInput("13/13/2026")).toBeNull();
    expect(parseDateInput("01/10")).toBeNull();
    expect(parseDateInput("")).toBeNull();
    expect(parseDateInput("01 Foo 2026")).toBeNull();
  });
  it("round-trips through formatDate", () => {
    expect(formatDate(toDate(parseDateInput("05/03/2026")!))).toBe("05 Mar 2026");
  });
});
