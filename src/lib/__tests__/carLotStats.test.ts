import { describe, expect, it } from "vitest";
import {
  NO_SPOT, ageBandOf, ageBands, awaitingArrivalInspection, carsOnHold, dailyMovements, inspectionState,
  lotKpis, mostOverFree, overFreeDays, stockByManufacturer, stockByZone, type LotVisit,
} from "../carLotStats";

const NOW = new Date(2026, 10, 21, 12, 0); // 21 Nov 2026, 12:00 local
const daysAgo = (d: number, h = 12, m = 0) => new Date(2026, 10, 21 - d, h, m);

let seq = 0;
const visit = (over: Partial<LotVisit> = {}): LotVisit => ({
  id: `v${++seq}`,
  ticketNumber: seq,
  status: "in-lot",
  gateIn: daysAgo(1),
  gateOut: null,
  freeDays: 7,
  zone: "A",
  slot: "1",
  vin: `JTDKB20U0930${String(seq).padStart(5, "0")}`,
  model: "Corolla",
  modelYear: 2026,
  color: "White",
  manufacturerCode: "TOY",
  manufacturerName: "Toyota",
  holdReason: null,
  heldAt: null,
  arrivalInspection: "closed",
  departureInspection: "missing",
  ...over,
});

describe("inspectionState", () => {
  it("tells closed, open and not started apart, per phase", () => {
    const rows = [{ phase: "gate_in", status: "closed" }, { phase: "gate_out", status: "open" }];
    expect(inspectionState(rows, "gate_in")).toBe("closed");
    expect(inspectionState(rows, "gate_out")).toBe("open");
    expect(inspectionState([], "gate_in")).toBe("missing");
    expect(inspectionState(null, "gate_out")).toBe("missing");
  });
});

describe("overFreeDays", () => {
  it("counts days the way the Cars list does: arrival day is day 1", () => {
    expect(overFreeDays(visit({ gateIn: daysAgo(6) }), NOW)).toBe(0); // day 7 of 7
    expect(overFreeDays(visit({ gateIn: daysAgo(7) }), NOW)).toBe(1); // day 8
    expect(overFreeDays(visit({ gateIn: daysAgo(10), freeDays: 0 }), NOW)).toBe(11);
  });

  it("stops at the release", () => {
    expect(overFreeDays(visit({ gateIn: daysAgo(20), gateOut: daysAgo(10), status: "out" }), NOW)).toBe(4);
  });
});

describe("lotKpis", () => {
  it("counts only cars still in the lot, except today's movements", () => {
    const visits = [
      visit({ gateIn: daysAgo(0, 8) }),                                       // arrived today
      visit({ gateIn: daysAgo(9), status: "on-hold", holdReason: "Customs" }), // over free, on hold
      visit({ gateIn: daysAgo(3), arrivalInspection: "open" }),
      visit({ gateIn: daysAgo(2), arrivalInspection: "missing" }),
      visit({ gateIn: daysAgo(30), gateOut: daysAgo(0, 9), status: "out" }),  // released today
      visit({ gateIn: daysAgo(30), gateOut: daysAgo(1, 23, 59), status: "out" }), // released yesterday
    ];
    expect(lotKpis(visits, NOW)).toEqual({
      inLot: 4,
      onHold: 1,
      overFree: 1,
      arrivedToday: 1,
      releasedToday: 1,
      arrivalNotClosed: 2,
      oldestDays: 10,
    });
  });

  it("treats midnight as the start of today", () => {
    const visits = [visit({ gateIn: daysAgo(0, 0, 0) }), visit({ gateIn: daysAgo(1, 23, 59) })];
    expect(lotKpis(visits, NOW).arrivedToday).toBe(1);
  });

  it("has no oldest car in an empty lot", () => {
    expect(lotKpis([], NOW)).toMatchObject({ inLot: 0, oldestDays: null });
  });
});

describe("age bands", () => {
  it("puts each day count in exactly one band", () => {
    expect([1, 7, 8, 14, 15, 30, 31, 90, 91, 400].map(ageBandOf)).toEqual([
      "week", "week", "twoWeeks", "twoWeeks", "month", "month", "quarter", "quarter", "long", "long",
    ]);
  });

  it("counts the cars in the lot only, every band listed in order", () => {
    const visits = [
      visit({ gateIn: daysAgo(0) }),
      visit({ gateIn: daysAgo(10) }),
      visit({ gateIn: daysAgo(100), status: "on-hold" }),
      visit({ gateIn: daysAgo(100), gateOut: daysAgo(1), status: "out" }),
    ];
    expect(ageBands(visits, NOW).map((b) => [b.key, b.count])).toEqual([
      ["week", 1], ["twoWeeks", 1], ["month", 0], ["quarter", 0], ["long", 1],
    ]);
  });
});

describe("stockByManufacturer", () => {
  it("groups by manufacturer, largest stock first, with average and oldest days", () => {
    const visits = [
      visit({ manufacturerCode: "KIA", manufacturerName: "Kia", gateIn: daysAgo(0) }),
      visit({ manufacturerCode: "TOY", manufacturerName: "Toyota", gateIn: daysAgo(1) }),       // day 2
      visit({ manufacturerCode: "TOY", manufacturerName: "Toyota", gateIn: daysAgo(9), status: "on-hold" }), // day 10
      visit({ manufacturerCode: "TOY", manufacturerName: "Toyota", gateIn: daysAgo(3) }),       // day 4
      visit({ manufacturerCode: "TOY", manufacturerName: "Toyota", gateIn: daysAgo(40), gateOut: daysAgo(2), status: "out" }),
    ];
    expect(stockByManufacturer(visits, NOW)).toEqual([
      { code: "TOY", name: "Toyota", inLot: 3, onHold: 1, overFree: 1, avgDays: 5.3, oldestDays: 10 },
      { code: "KIA", name: "Kia", inLot: 1, onHold: 0, overFree: 0, avgDays: 1, oldestDays: 1 },
    ]);
  });

  it("breaks a tie by name", () => {
    const visits = [
      visit({ manufacturerCode: "TOY", manufacturerName: "Toyota" }),
      visit({ manufacturerCode: "HYU", manufacturerName: "Hyundai" }),
    ];
    expect(stockByManufacturer(visits, NOW).map((r) => r.code)).toEqual(["HYU", "TOY"]);
  });
});

describe("stockByZone", () => {
  it("merges zones typed differently, sorts naturally and puts cars without a zone last", () => {
    const visits = [
      visit({ zone: " z10 " }),
      visit({ zone: "Z2" }),
      visit({ zone: "z2" }),
      visit({ zone: null }),
      visit({ zone: "  " }),
      visit({ zone: "Z2", status: "out", gateOut: daysAgo(0) }),
    ];
    expect(stockByZone(visits)).toEqual([
      { zone: "Z2", count: 2 },
      { zone: "Z10", count: 1 },
      { zone: NO_SPOT, count: 2 },
    ]);
  });
});

describe("dailyMovements", () => {
  it("has one point per day, oldest first, ending today", () => {
    const points = dailyMovements([], 30, NOW);
    expect(points).toHaveLength(30);
    expect(points[29].dayKey).toBe("2026-11-21");
    expect(points[0].dayKey).toBe("2026-10-23");
  });

  it("counts arrivals and releases on their own local day", () => {
    const visits = [
      visit({ gateIn: daysAgo(0, 0, 5) }),
      visit({ gateIn: daysAgo(1, 23, 55) }),
      visit({ gateIn: daysAgo(5), gateOut: daysAgo(0, 10), status: "out" }),
      visit({ gateIn: daysAgo(40), gateOut: daysAgo(1, 9), status: "out" }), // arrived before the window
    ];
    const points = dailyMovements(visits, 7, NOW);
    const byDay = Object.fromEntries(points.map((p) => [p.dayKey, [p.arrivals, p.releases]]));
    expect(byDay["2026-11-21"]).toEqual([1, 1]);
    expect(byDay["2026-11-20"]).toEqual([1, 1]);
    expect(byDay["2026-11-16"]).toEqual([1, 0]);
    expect(points.reduce((n, p) => n + p.arrivals, 0)).toBe(3);
  });
});

describe("needs attention", () => {
  it("lists cars in the lot without a closed arrival inspection, the longest waiting first", () => {
    const newer = visit({ gateIn: daysAgo(1), arrivalInspection: "missing" });
    const older = visit({ gateIn: daysAgo(4), arrivalInspection: "open" });
    const done = visit({ gateIn: daysAgo(5) });
    const gone = visit({ gateIn: daysAgo(9), gateOut: daysAgo(2), status: "out", arrivalInspection: "missing" });
    expect(awaitingArrivalInspection([newer, older, done, gone]).map((v) => v.id)).toEqual([older.id, newer.id]);
  });

  it("lists cars on hold, the longest held first", () => {
    const recent = visit({ status: "on-hold", heldAt: daysAgo(1) });
    const long = visit({ status: "on-hold", heldAt: daysAgo(6) });
    expect(carsOnHold([recent, visit(), long]).map((v) => v.id)).toEqual([long.id, recent.id]);
  });

  it("ranks the cars furthest past their free days, up to the limit", () => {
    const a = visit({ gateIn: daysAgo(20) });               // day 21, over 14
    const b = visit({ gateIn: daysAgo(9) });                // day 10, over 3
    const c = visit({ gateIn: daysAgo(12), freeDays: 30 }); // within free days
    const d = visit({ gateIn: daysAgo(30), gateOut: daysAgo(1), status: "out" });
    expect(mostOverFree([b, c, a, d], NOW).map((r) => [r.visit.id, r.over, r.days])).toEqual([[a.id, 14, 21], [b.id, 3, 10]]);
    expect(mostOverFree([a, b], NOW, 1)).toHaveLength(1);
  });
});
