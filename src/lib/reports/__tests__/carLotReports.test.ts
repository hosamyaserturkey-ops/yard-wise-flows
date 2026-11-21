import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  buildLotDamageReport, buildLotDwellReport, buildLotHoldsReport, buildLotMovementsReport, buildLotReport,
  buildLotStockReport, lotMonthRows, lotMoves, lotPeriodSummary, pairHolds,
  type CarLotReportContext, type HoldEvent, type LotReportKind, type LotReportVisit,
} from "../carLotReportData";
import { periodFromFilters } from "../reportFilters";
import { renderWorkbook } from "../workbook";
import type { ReportSpec } from "../reportModel";

const NOW = new Date(2026, 10, 21, 12, 0); // 21 Nov 2026, 12:00 local
const NOV = periodFromFilters({ dateFrom: "2026-11-01", dateTo: "2026-11-21" });
const OCT_NOV = periodFromFilters({ dateFrom: "2026-10-01", dateTo: "2026-11-21" });
const on = (month: number, day: number, h = 12) => new Date(2026, month - 1, day, h, 0);

let seq = 0;
const car = (over: Partial<LotReportVisit>): LotReportVisit => ({
  id: `v${++seq}`,
  ticketNumber: 100 + seq,
  status: "in-lot",
  gateIn: on(11, 1),
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
  driverIn: "HASAN",
  truckIn: "6088132",
  driverOut: null,
  truckOut: null,
  odometerIn: 12,
  odometerOut: null,
  receivedBy: "Lot Admin",
  releasedBy: null,
  damageIn: [],
  damageOut: [],
  ...over,
});

// In the lot since 25 Oct 10:00: day 28 on 21 Nov 12:00, 21 over its 7 free days.
const A = car({ gateIn: on(10, 25, 10), damageIn: ["Scratch, rear left door"] });
// 3 Nov 09:00 to 10 Nov 15:00: 8 days, 1 over free.
const B = car({
  gateIn: on(11, 3, 9), gateOut: on(11, 10, 15), status: "out", departureInspection: "closed",
  driverOut: "SAMI", truckOut: "12-3456", odometerOut: 120, releasedBy: "Office User", damageOut: ["Dent, front bumper"],
});
// Hyundai, on hold, arrival inspection still open, day 7.
const C = car({
  gateIn: on(11, 15, 8), status: "on-hold", holdReason: "Customs", heldAt: on(11, 16, 10),
  manufacturerCode: "HYU", manufacturerName: "Hyundai", arrivalInspection: "open", damageIn: ["Chip, windscreen"],
});
// Kia, 20 Oct to 5 Nov: 17 days, 10 over free.
const D = car({ gateIn: on(10, 20), gateOut: on(11, 5), status: "out", manufacturerCode: "KIA", manufacturerName: "Kia" });
// Released 1 Oct after 30 days: before November.
const E = car({ gateIn: on(9, 2), gateOut: on(10, 1), status: "out" });
// Arrived today.
const F = car({ gateIn: on(11, 21, 9) });
const ALL = [A, B, C, D, E, F];

const ctx = (period = NOV): CarLotReportContext => ({
  now: NOW,
  period,
  yardId: "lot",
  yardNames: { lot: "Everest Logistics - Car Lot" },
  yardCodes: { lot: "evl-cars" },
  filtersLabel: "",
  generatedBy: "Lot Admin",
});

const kpi = (spec: ReportSpec, label: string) => spec.sheets[0].kpis?.find((k) => k.label === label)?.value;

describe("lotMoves", () => {
  it("lists the arrivals and releases inside the period, oldest first", () => {
    expect(lotMoves(ALL, NOV).map((m) => `${m.direction} ${m.visit.id}`)).toEqual([
      `In ${B.id}`, `Out ${D.id}`, `Out ${B.id}`, `In ${C.id}`, `In ${F.id}`,
    ]);
  });
});

describe("lotPeriodSummary", () => {
  it("gives the Reports page its preview numbers", () => {
    expect(lotPeriodSummary(ALL, NOV, NOW)).toEqual({ arrivals: 3, releases: 2, avgDaysReleased: 12.5, inLotAtEnd: 3 });
  });

  it("counts the lot at the end of a period that is over", () => {
    const october = periodFromFilters({ dateFrom: "2026-10-01", dateTo: "2026-10-31" });
    // On 31 Oct: A and D were in; B, C and F had not arrived; E had left.
    expect(lotPeriodSummary(ALL, october, NOW).inLotAtEnd).toBe(2);
  });
});

describe("buildLotStockReport", () => {
  const spec = buildLotStockReport(ALL, ctx());

  it("summarises the cars in the lot now, whatever the period", () => {
    expect(kpi(spec, "Cars in the lot")).toBe(3);
    expect(kpi(spec, "On hold")).toBe(1);
    expect(kpi(spec, "Over their free days")).toBe(1);
    expect(kpi(spec, "Average days in the lot")).toBe(12); // (28 + 7 + 1) / 3
    expect(kpi(spec, "Longest stay (days)")).toBe(28);
    expect(kpi(spec, "Arrival inspection not closed")).toBe(1);
  });

  it("lists every car in the lot, longest first, with its damage notes", () => {
    const rows = spec.sheets[1].tables[0].rows;
    expect(rows.map((r) => r.vin)).toEqual([A.vin, C.vin, F.vin]);
    expect(rows[0]).toMatchObject({ days: 28, overFree: 21, damageCount: 1, damageNotes: "Scratch, rear left door", status: "In lot" });
    expect(rows[1]).toMatchObject({ status: "On hold", holdReason: "Customs", inspection: "Open" });
    expect(spec.fileName).toBe("EVL-CARS_Car_Stock_2026-11-21.xlsx");
  });
});

describe("buildLotMovementsReport", () => {
  it("counts arrivals, releases and the lot at the end", () => {
    const spec = buildLotMovementsReport(ALL, ctx());
    expect(kpi(spec, "Arrivals")).toBe(3);
    expect(kpi(spec, "Releases")).toBe(2);
    expect(kpi(spec, "Net change")).toBe(1);
    expect(kpi(spec, "In the lot at the end")).toBe(3);
    const out = spec.sheets[2].tables[0].rows.find((r) => r.direction === "Out" && r.vin === B.vin);
    expect(out).toMatchObject({ driver: "SAMI", truck: "12-3456", odometer: 120, by: "Office User" });
  });

  it("splits the period by month and manufacturer, cutting the last month at now", () => {
    expect(lotMonthRows(ALL, OCT_NOV, NOW)).toEqual([
      { month: "October 2026", manufacturer: "Kia", arrivals: 1, releases: 0, inLotAtEnd: 1, avgDaysReleased: null },
      { month: "October 2026", manufacturer: "Toyota", arrivals: 1, releases: 1, inLotAtEnd: 1, avgDaysReleased: 30 },
      { month: "November 2026", manufacturer: "Hyundai", arrivals: 1, releases: 0, inLotAtEnd: 1, avgDaysReleased: null },
      { month: "November 2026", manufacturer: "Kia", arrivals: 0, releases: 1, inLotAtEnd: 0, avgDaysReleased: 17 },
      { month: "November 2026", manufacturer: "Toyota", arrivals: 2, releases: 1, inLotAtEnd: 2, avgDaysReleased: 8 },
    ]);
  });
});

describe("buildLotDwellReport", () => {
  it("covers the cars released in the period", () => {
    const spec = buildLotDwellReport(ALL, ctx());
    expect(kpi(spec, "Cars released")).toBe(2);
    expect(kpi(spec, "Average days in the lot")).toBe(12.5);
    expect(kpi(spec, "Longest stay (days)")).toBe(17);
    expect(kpi(spec, "Released past their free days")).toBe(2);
    expect(kpi(spec, "Days over free, all cars")).toBe(11);
    expect(spec.sheets[1].tables[0].rows.map((r) => [r.vin, r.days, r.overFree])).toEqual([[D.vin, 17, 10], [B.vin, 8, 1]]);
  });
});

describe("buildLotDamageReport", () => {
  it("puts arrival and departure damage side by side for cars that moved in the period", () => {
    const spec = buildLotDamageReport(ALL, ctx());
    expect(kpi(spec, "Cars arrived")).toBe(3);
    expect(kpi(spec, "Arrived with damage noted")).toBe(1);
    expect(kpi(spec, "Share of arrivals with damage")).toBe("33%");
    expect(kpi(spec, "Released with damage noted at departure")).toBe(1);
    expect(kpi(spec, "Share of releases with damage")).toBe("50%");
    const rows = spec.sheets[1].tables[0].rows;
    expect(rows.map((r) => r.vin)).toEqual([D.vin, B.vin, C.vin, F.vin]);
    expect(rows[1]).toMatchObject({ outCount: 1, outNotes: "Dent, front bumper", outInspection: "Closed" });
    expect(rows[2]).toMatchObject({ inCount: 1, inNotes: "Chip, windscreen", outInspection: "" });
  });
});

describe("holds", () => {
  const events: HoldEvent[] = [
    { visitId: A.id, at: on(11, 5, 9), action: "hold", actorName: "Lot Admin", reason: "Paperwork" },
    { visitId: A.id, at: on(11, 7, 9), action: "release_hold", actorName: "Office User", reason: null },
    { visitId: C.id, at: on(11, 16, 10), action: "hold", actorName: "Lot Admin", reason: "Customs" },
    { visitId: D.id, at: on(11, 2, 8), action: "release_hold", actorName: "Lot Admin", reason: null },
  ];

  it("pairs each hold with its release, and keeps holds that began before the history", () => {
    const G = car({ status: "on-hold", holdReason: null, heldAt: null });
    const holds = pairHolds(events, [...ALL, G]);
    expect(holds).toHaveLength(4);
    expect(holds.find((h) => h.visitId === A.id)).toMatchObject({ start: on(11, 5, 9), end: on(11, 7, 9), reason: "Paperwork", endedBy: "Office User" });
    expect(holds.find((h) => h.visitId === C.id)).toMatchObject({ end: null, startedBy: "Lot Admin" });
    expect(holds.find((h) => h.visitId === D.id)).toMatchObject({ start: null, end: on(11, 2, 8) });
    expect(holds.find((h) => h.visitId === G.id)).toMatchObject({ start: null, end: null });
  });

  it("reports the holds that touch the period, with their length", () => {
    const spec = buildLotHoldsReport(ALL, pairHolds(events, ALL), ctx());
    expect(kpi(spec, "Holds in the period")).toBe(3);
    expect(kpi(spec, "Still on hold")).toBe(1);
    expect(kpi(spec, "Average days on hold (released holds)")).toBe(2);
    const rows = spec.sheets[1].tables[0].rows;
    expect(rows.map((r) => r.vin)).toEqual([D.vin, A.vin, C.vin]);
    expect(rows[0]).toMatchObject({ start: "Before 21 Nov 2026", days: null });
    expect(rows[2]).toMatchObject({ end: "Still on hold", reason: "Customs", days: 5.1 });
  });

  it("leaves out holds over before the period starts", () => {
    const fromEighth = periodFromFilters({ dateFrom: "2026-11-08", dateTo: "2026-11-21" });
    const spec = buildLotHoldsReport(ALL, pairHolds(events, ALL), ctx(fromEighth));
    expect(spec.sheets[1].tables[0].rows.map((r) => r.vin)).toEqual([C.vin]);
  });
});

describe("rendering", () => {
  const kinds: LotReportKind[] = ["stock", "movements", "dwell", "damage", "holds"];

  it.each(kinds)("renders the %s report to a workbook that opens", async (kind) => {
    const spec = buildLotReport(kind, ALL, pairHolds([], ALL), ctx());
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await renderWorkbook(spec).xlsx.writeBuffer()) as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(spec.sheets.map((s) => s.name));
    const detail = wb.worksheets[wb.worksheets.length - 1];
    expect(detail.getCell("A1").value).toBe(`${spec.title} — ${spec.sheets[spec.sheets.length - 1].name}`);
    expect(detail.getCell("A4").value).toBe(spec.sheets[spec.sheets.length - 1].tables[0].columns[0].header);
  });

  it("still renders an empty report", async () => {
    const spec = buildLotReport("movements", [], [], ctx());
    await expect(renderWorkbook(spec).xlsx.writeBuffer()).resolves.toBeTruthy();
  });
});
