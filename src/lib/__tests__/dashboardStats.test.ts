import { describe, expect, it } from "vitest";
import {
  agingBucketOf,
  computeAgingBuckets,
  computeDailyTrend,
  computeLineDistribution,
  computeStockByLine,
  computeTodayActivity,
  dayKey,
  daysInYard,
  sizeBucketOf,
  timeAgo,
  type SizeBucket,
} from "../dashboardStats";
import { ALL_ACCEPTED_TYPE_CODES } from "../containerTypes";

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
    const trend = computeDailyTrend(containers, 7, NOW);
    expect(trend).toHaveLength(7);
    expect(trend[6].gateIn).toBe(2); // today
    expect(trend[0].gateIn).toBe(1); // six days ago
    expect(trend.reduce((s, d) => s + d.gateIn, 0)).toBe(3);
  });

  it("counts gate-outs as a separate series", () => {
    const containers = [
      { gateInTime: daysAgo(6), gateOutTime: daysAgo(0) },
      { gateInTime: daysAgo(3), gateOutTime: undefined },
    ];
    const trend = computeDailyTrend(containers, 7, NOW);
    expect(trend[6].gateOut).toBe(1);
    expect(trend[6].gateIn).toBe(0);
    expect(trend.reduce((s, d) => s + d.gateOut, 0)).toBe(1);
  });

  it("honours a wider window and tags each point with a day key", () => {
    const containers = [{ gateInTime: daysAgo(20) }];
    expect(computeDailyTrend(containers, 7, NOW).reduce((s, d) => s + d.gateIn, 0)).toBe(0);

    const wide = computeDailyTrend(containers, 30, NOW);
    expect(wide).toHaveLength(30);
    expect(wide.reduce((s, d) => s + d.gateIn, 0)).toBe(1);
    expect(wide[29].dayKey).toBe("2026-07-15"); // today, local time
  });
});

describe("agingBucketOf", () => {
  it("places containers on the right side of each boundary", () => {
    expect(agingBucketOf(daysAgo(0), NOW)).toBe("fresh");
    expect(agingBucketOf(daysAgo(7), NOW)).toBe("fresh");
    expect(agingBucketOf(daysAgo(8), NOW)).toBe("week");
    expect(agingBucketOf(daysAgo(14), NOW)).toBe("week");
    expect(agingBucketOf(daysAgo(15), NOW)).toBe("twoWeeks");
    expect(agingBucketOf(daysAgo(21), NOW)).toBe("twoWeeks");
    expect(agingBucketOf(daysAgo(22), NOW)).toBe("threeWeeks");
    expect(agingBucketOf(daysAgo(30), NOW)).toBe("threeWeeks");
    expect(agingBucketOf(daysAgo(31), NOW)).toBe("stale");
    expect(agingBucketOf(daysAgo(400), NOW)).toBe("stale");
  });
});

describe("sizeBucketOf", () => {
  // Every code the app can store — the 13 current ISO 6346 group codes plus the
  // three legacy ones still accepted by validation.
  const cases: [string, SizeBucket][] = [
    ["20GP", "small"],
    ["20OT", "small"],
    ["20FR", "small"], // FR is Flat Rack, not Reefer
    ["20TK", "small"],
    ["20FT", "small"], // legacy
    ["40GP", "large"],
    ["40OT", "large"],
    ["40FR", "large"], // FR is Flat Rack, not Reefer
    ["40TK", "large"],
    ["40FT", "large"], // legacy
    ["40HC", "hc"],
    ["45HC", "hc"],
    ["45FT", "hc"], // legacy
    ["20RF", "reefer"],
    ["40RF", "reefer"],
    ["40RH", "reefer"],
  ];

  it.each(cases)("maps %s onto the %s bucket", (type, bucket) => {
    expect(sizeBucketOf(type)).toBe(bucket);
  });

  it("covers every code accepted by validation", () => {
    for (const code of ALL_ACCEPTED_TYPE_CODES) {
      expect(sizeBucketOf(code), `${code} should bucket`).not.toBeNull();
    }
    expect(cases.map(([type]) => type).sort()).toEqual([...ALL_ACCEPTED_TYPE_CODES].sort());
  });

  it("is case-insensitive and tolerates surrounding space", () => {
    expect(sizeBucketOf("40ft")).toBe("large");
    expect(sizeBucketOf(" 20gp ")).toBe("small");
  });

  it("returns null for an unrecognisable type", () => {
    expect(sizeBucketOf("SOMETHING-ELSE")).toBeNull();
    expect(sizeBucketOf("")).toBeNull();
  });
});

describe("dayKey", () => {
  it("formats a local-time yyyy-mm-dd key", () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(dayKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });
});

describe("computeLineDistribution", () => {
  it("counts per line, sorted descending", () => {
    const containers = [
      { status: "in-yard", shippingLine: "SLD" },
      { status: "in-yard", shippingLine: "SLD" },
      { status: "in-yard", shippingLine: "WOM" },
    ];
    expect(computeLineDistribution(containers)).toEqual([
      { name: "SLD", value: 2 },
      { name: "WOM", value: 1 },
    ]);
  });

  it("ignores reserved and gated-out containers", () => {
    const containers = [
      { status: "in-yard", shippingLine: "SLD" },
      { status: "reserved", shippingLine: "SLD" },
      { status: "out", shippingLine: "WOM" },
    ];
    expect(computeLineDistribution(containers)).toEqual([{ name: "SLD", value: 1 }]);
  });
});

describe("computeStockByLine", () => {
  it("splits in-yard stock by size bucket and ignores gated-out units", () => {
    const containers = [
      { status: "in-yard", shippingLine: "SLD", containerType: "20GP" }, // small
      { status: "in-yard", shippingLine: "SLD", containerType: "40GP" }, // large
      { status: "in-yard", shippingLine: "SLD", containerType: "40FR" }, // large — flat rack
      { status: "in-yard", shippingLine: "SLD", containerType: "40HC" }, // hc
      { status: "in-yard", shippingLine: "SLD", containerType: "45HC" }, // hc
      { status: "in-yard", shippingLine: "SLD", containerType: "20RF" }, // reefer
      { status: "in-yard", shippingLine: "SLD", containerType: "40RH" }, // reefer
      { status: "out", shippingLine: "SLD", containerType: "20GP" },
      { status: "in-yard", shippingLine: "WOM", containerType: "20FT" }, // legacy
    ];
    expect(computeStockByLine(containers)).toEqual([
      { line: "SLD", small: 1, large: 2, hc: 2, reefer: 2, total: 7 },
      { line: "WOM", small: 1, large: 0, hc: 0, reefer: 0, total: 1 },
    ]);
  });

  // The reported bug: a line stocked entirely with 20GP showed 0 in every size
  // column while Total read 25, because sizeBucketOf only matched legacy codes.
  it("counts a line stocked entirely with one ISO code", () => {
    const containers = Array.from({ length: 25 }, () => ({
      status: "in-yard",
      shippingLine: "7Seas",
      containerType: "20GP",
    }));
    expect(computeStockByLine(containers)).toEqual([
      { line: "7Seas", small: 25, large: 0, hc: 0, reefer: 0, total: 25 },
    ]);
  });

  it("keeps the size columns summing to the row total", () => {
    const containers = ALL_ACCEPTED_TYPE_CODES.map((containerType) => ({
      status: "in-yard",
      shippingLine: "SLD",
      containerType,
    }));
    const [row] = computeStockByLine(containers);
    expect(row.small + row.large + row.hc + row.reefer).toBe(row.total);
    expect(row.total).toBe(ALL_ACCEPTED_TYPE_CODES.length);
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
