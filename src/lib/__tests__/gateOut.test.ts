import { describe, expect, it } from "vitest";
import { dwellDays, formatDwell, formatJod, matchesGateOutSearch, normalizeFees } from "../gateOut";
import type { Container } from "@/types/container";

const NOW = new Date("2026-08-24T12:00:00");

const make = (over: Partial<Container> = {}): Container => ({
  id: "visit-1",
  ticketNumber: 1,
  containerNumber: "CIMU1960091",
  containerType: "40HC",
  shippingLine: "WOM",
  driverName: "KARAR",
  truckNumber: "22L10272",
  gateInTime: new Date("2026-08-23T16:59:23"),
  status: "in-yard",
  ...over,
});

describe("dwellDays", () => {
  it("counts whole days since gate-in", () => {
    expect(dwellDays(new Date("2026-08-21T12:00:00"), NOW)).toBe(3);
    expect(dwellDays(new Date("2026-08-24T00:00:00"), NOW)).toBe(0);
  });

  it("never goes negative for a future gate-in", () => {
    expect(dwellDays(new Date("2026-08-30T12:00:00"), NOW)).toBe(0);
  });

  it("returns 0 for an invalid date rather than NaN", () => {
    expect(dwellDays(new Date("not a date"), NOW)).toBe(0);
  });
});

describe("formatDwell", () => {
  it("labels each bucket", () => {
    expect(formatDwell(0)).toBe("Today");
    expect(formatDwell(1)).toBe("1 day");
    expect(formatDwell(12)).toBe("12 days");
  });
});

describe("matchesGateOutSearch", () => {
  const container = make({ bookingNumber: "BK-4417", shippingLine: "WOM" });

  it("matches an empty or whitespace term", () => {
    expect(matchesGateOutSearch(container, "")).toBe(true);
    expect(matchesGateOutSearch(container, "   ")).toBe(true);
  });

  it("matches container number, driver and truck case-insensitively", () => {
    expect(matchesGateOutSearch(container, "cimu196")).toBe(true);
    expect(matchesGateOutSearch(container, "karar")).toBe(true);
    expect(matchesGateOutSearch(container, "22l10272")).toBe(true);
  });

  it("also matches booking number, line and type", () => {
    expect(matchesGateOutSearch(container, "bk-4417")).toBe(true);
    expect(matchesGateOutSearch(container, "wom")).toBe(true);
    expect(matchesGateOutSearch(container, "40hc")).toBe(true);
  });

  it("does not match unrelated text, and tolerates a missing booking", () => {
    expect(matchesGateOutSearch(container, "zzz")).toBe(false);
    expect(matchesGateOutSearch(make({ bookingNumber: undefined }), "bk-4417")).toBe(false);
  });
});

describe("normalizeFees", () => {
  it("rounds to the three decimals the ticket prints", () => {
    expect(normalizeFees("12.3456")).toBe(12.346);
    expect(normalizeFees(" 7 ")).toBe(7);
    expect(normalizeFees("0")).toBe(0);
  });

  it("rejects blank, negative and non-numeric input", () => {
    expect(normalizeFees("")).toBeNull();
    expect(normalizeFees("   ")).toBeNull();
    expect(normalizeFees("-1")).toBeNull();
    expect(normalizeFees("abc")).toBeNull();
  });
});

describe("formatJod", () => {
  it("always prints three decimals", () => {
    expect(formatJod(7)).toBe("7.000");
    expect(formatJod(1234.5)).toBe("1,234.500");
  });
});
