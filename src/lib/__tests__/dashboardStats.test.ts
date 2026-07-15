import { describe, expect, it } from "vitest";
import {
  computeAgingBuckets,
  computeDailyTrend,
  computeLineDistribution,
  computeStockByLine,
  computeTodayActivity,
  daysInYard,
  timeAgo,
} from "../dashboardStats";

const NOW = new Date("2026-07-15T12:00:00");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe("daysInYard", () => {
  it("floors to whole days and never goes negative", () => {
    expect(daysInYard(daysAgo(3), NOW)).toBe(3);
    expect(daysInYard(new Date(NOW.getTime() - 1000), NOW)).toBe(0);
    expect(daysInYard(new Date(NOW.getTime() + 60_000), NOW)).toBe(0);
  });
});

describe("timeAgo", () => {
  it("picks the right unit", () => {
    expect(timeAgo(new Date(NOW.getTime() - 5 * 60_000), NOW)).toBe("5m ago");
    expect(timeAgo(new Date(NOW.getTime() - 3 * 3_600_000), NOW)).toBe("3h ago");
    expect(timeAgo(daysAgo(2), NOW)).toBe("2d ago");
  });
});

describe("computeDailyTrend", () => {
  it("buckets gate-ins into the last 7 days", () => {
    const containers = [
      { gateInTime: daysAgo(0) },
      { gateInTime: daysAgo(0) },
      { gateInTime: daysAgo(6) },
      { gateInTime: daysAgo(10) }, // outside window
    ];
    const trend = computeDailyTrend(containers, NOW);
    expect(trend).toHaveLength(7);
    expect(trend[6].count).toBe(2); // today
    expect(trend[0].count).toBe(1); // six days ago
    expect(trend.reduce((s, d) => s + d.count, 0)).toBe(3);
  });
});

describe("computeLineDistribution", () => {
  it("counts per line, sorted descending", () => {
    const containers = [
      { shippingLine: "SLD" },
      { shippingLine: "SLD" },
      { shippingLine: "WOM" },
    ];
    expect(computeLineDistribution(containers)).toEqual([
      { name: "SLD", value: 2 },
      { name: "WOM", value: 1 },
    ]);
  });
});

describe("computeStockByLine", () => {
  it("splits in-yard stock by size bucket and ignores gated-out units", () => {
    const containers = [
      { status: "in-yard", shippingLine: "SLD", containerType: "20FT" },
      { status: "in-yard", shippingLine: "SLD", containerType: "40FT" },
      { status: "in-yard", shippingLine: "SLD", containerType: "40HC" },
      { status: "in-yard", shippingLine: "SLD", containerType: "45FT" },
      { status: "in-yard", shippingLine: "SLD", containerType: "40FR" },
      { status: "out", shippingLine: "SLD", containerType: "20FT" },
      { status: "in-yard", shippingLine: "WOM", containerType: "20FT" },
    ];
    expect(computeStockByLine(containers)).toEqual([
      { line: "SLD", small: 1, large: 1, hc: 2, reefer: 1, total: 5 },
      { line: "WOM", small: 1, large: 0, hc: 0, reefer: 0, total: 1 },
    ]);
  });
});

describe("computeAgingBuckets", () => {
  it("assigns in-yard containers to age buckets", () => {
    const containers = [
      { status: "in-yard", gateInTime: daysAgo(1) },   // fresh
      { status: "in-yard", gateInTime: daysAgo(7) },   // fresh (boundary)
      { status: "in-yard", gateInTime: daysAgo(10) },  // week
      { status: "in-yard", gateInTime: daysAgo(20) },  // twoWeeks
      { status: "in-yard", gateInTime: daysAgo(28) },  // threeWeeks
      { status: "in-yard", gateInTime: daysAgo(45) },  // stale
      { status: "out", gateInTime: daysAgo(45) },      // ignored
    ];
    expect(computeAgingBuckets(containers, NOW)).toEqual({
      fresh: 2,
      week: 1,
      twoWeeks: 1,
      threeWeeks: 1,
      stale: 1,
    });
  });
});

describe("computeTodayActivity", () => {
  it("counts today's gate-ins/outs and current reservations", () => {
    const startOfToday = new Date(NOW);
    startOfToday.setHours(2, 0, 0, 0);
    const containers = [
      { status: "in-yard", gateInTime: startOfToday, gateOutTime: undefined },
      { status: "out", gateInTime: daysAgo(3), gateOutTime: new Date(NOW.getTime() - 3_600_000) },
      { status: "reserved", gateInTime: daysAgo(5), gateOutTime: undefined },
      { status: "out", gateInTime: daysAgo(9), gateOutTime: daysAgo(8) }, // not today
    ];
    expect(computeTodayActivity(containers, NOW)).toEqual({
      gateIn: 1,
      gateOut: 1,
      reserved: 1,
    });
  });
});
