import { describe, expect, it } from "vitest";
import {
  describeFilters,
  EMPTY_FILTERS,
  formatDayKey,
  hasActiveFilters,
  scopeContainers,
  toggleFilter,
  type DashboardFilters,
} from "../dashboardFilters";

const NOW = new Date("2026-07-15T12:00:00");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

const make = (
  over: Partial<{
    status: string;
    containerType: string;
    shippingLine: string;
    gateInTime: Date;
  }> = {},
) => ({
  status: "in-yard",
  containerType: "20FT",
  shippingLine: "SLD",
  gateInTime: daysAgo(1),
  ...over,
});

const filters = (over: Partial<DashboardFilters> = {}): DashboardFilters => ({
  ...EMPTY_FILTERS,
  ...over,
});

describe("hasActiveFilters", () => {
  it("is false only when every dimension is null", () => {
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
    expect(hasActiveFilters(filters({ line: "SLD" }))).toBe(true);
    expect(hasActiveFilters(filters({ bucket: "stale" }))).toBe(true);
  });
});

describe("scopeContainers", () => {
  const containers = [
    make({ shippingLine: "SLD", containerType: "20FT", gateInTime: daysAgo(1) }),
    make({ shippingLine: "SLD", containerType: "40HC", gateInTime: daysAgo(40) }),
    make({ shippingLine: "WOM", containerType: "20FT", gateInTime: daysAgo(1) }),
    make({ shippingLine: "WOM", containerType: "40FR", gateInTime: daysAgo(40), status: "out" }),
  ];

  it("returns everything when no filter is active", () => {
    expect(scopeContainers(containers, EMPTY_FILTERS, {}, NOW)).toHaveLength(4);
  });

  it("filters by line", () => {
    const result = scopeContainers(containers, filters({ line: "SLD" }), {}, NOW);
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.shippingLine === "SLD")).toBe(true);
  });

  it("filters by size bucket", () => {
    const result = scopeContainers(containers, filters({ size: "small" }), {}, NOW);
    expect(result).toHaveLength(2);
    expect(result.every((c) => c.containerType === "20FT")).toBe(true);
  });

  it("filters by gate-in day", () => {
    const result = scopeContainers(containers, filters({ day: "2026-07-14" }), {}, NOW);
    expect(result).toHaveLength(2);
  });

  it("filters by age band, and only ever matches in-yard containers", () => {
    const stale = scopeContainers(containers, filters({ bucket: "stale" }), {}, NOW);
    // Two containers are 40 days old, but the gated-out one is excluded.
    expect(stale).toHaveLength(1);
    expect(stale[0].shippingLine).toBe("SLD");

    const fresh = scopeContainers(containers, filters({ bucket: "fresh" }), {}, NOW);
    expect(fresh).toHaveLength(2);
  });

  it("combines dimensions with AND", () => {
    const result = scopeContainers(
      containers,
      filters({ line: "SLD", size: "small" }),
      {},
      NOW,
    );
    expect(result).toHaveLength(1);
    expect(result[0].containerType).toBe("20FT");
  });

  it("skips a single excluded dimension", () => {
    const f = filters({ line: "SLD", size: "small" });
    // Excluding `line` leaves only the size filter applied.
    const result = scopeContainers(containers, f, { exclude: "line" }, NOW);
    expect(result).toHaveLength(2);
    expect(result.map((c) => c.shippingLine)).toEqual(["SLD", "WOM"]);
  });

  it("skips a list of excluded dimensions", () => {
    const f = filters({ line: "SLD", size: "small", bucket: "fresh" });
    const result = scopeContainers(containers, f, { exclude: ["line", "size"] }, NOW);
    // Only the age filter survives.
    expect(result).toHaveLength(2);
  });

  it("returns an empty list when nothing matches", () => {
    const result = scopeContainers(
      containers,
      filters({ line: "SLD", size: "reefer" }),
      {},
      NOW,
    );
    expect(result).toEqual([]);
  });
});

describe("toggleFilter", () => {
  it("sets a value, and clears it when re-selected", () => {
    const once = toggleFilter(EMPTY_FILTERS, "line", "SLD");
    expect(once.line).toBe("SLD");
    expect(toggleFilter(once, "line", "SLD").line).toBeNull();
    expect(toggleFilter(once, "line", "WOM").line).toBe("WOM");
  });

  it("leaves other dimensions untouched", () => {
    const f = toggleFilter(filters({ bucket: "stale" }), "line", "SLD");
    expect(f).toEqual(filters({ bucket: "stale", line: "SLD" }));
  });
});

describe("describeFilters", () => {
  it("returns one chip per active dimension, in a stable order", () => {
    const chips = describeFilters(
      filters({ day: "2026-07-15", line: "SLD", bucket: "stale", size: "hc" }),
    );
    expect(chips.map((c) => c.key)).toEqual(["line", "size", "bucket", "day"]);
    expect(chips.map((c) => c.value)).toEqual([
      "SLD",
      "40HC/45",
      "30+ days",
      "15 Jul 2026",
    ]);
  });

  it("is empty when no filter is active", () => {
    expect(describeFilters(EMPTY_FILTERS)).toEqual([]);
  });
});

describe("formatDayKey", () => {
  it("renders a day key as local-time day/month/year", () => {
    expect(formatDayKey("2026-01-05")).toBe("5 Jan 2026");
  });

  it("passes through anything unparseable", () => {
    expect(formatDayKey("nonsense")).toBe("nonsense");
  });
});
