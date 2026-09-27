import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  buildDriversReport,
  buildFeesReport,
  buildInYardReport,
  buildMovementsReport,
  dwellDays,
  moveCarrier,
  gateMoves,
  normalizeName,
  teuOf,
  type ReportContext,
  type ReportPayment,
  type ReportVisit,
} from "../reportData";
import { filtersLabel, matchesFilters, periodFromFilters } from "../reportFilters";
import { renderWorkbook, toExcelLocal } from "../workbook";
import type { ReportSpec, ReportTable } from "../reportModel";

const NOW = new Date(2026, 8, 27, 12, 0); // 27 Sep 2026, 12:00 local
const daysAgo = (d: number, h = 9) => new Date(2026, 8, 27 - d, h, 0);

let seq = 0;
const visit = (over: Partial<ReportVisit>): ReportVisit => ({
  id: `v${++seq}`,
  yardId: "y1",
  ticketNumber: seq,
  containerNumber: `TEMU${String(seq).padStart(7, "0")}`,
  containerType: "20GP",
  shippingLine: "WOM",
  driverName: "HASAN",
  truckNumber: "6088132",
  gateInTime: daysAgo(1),
  status: "in-yard",
  ...over,
});

const ctx = (over: Partial<ReportContext> = {}): ReportContext => ({
  now: NOW,
  period: {},
  yardNames: { y1: "Everest Logistics Services", y2: "North Yard" },
  yardCodes: { y1: "evl", y2: "nth" },
  filtersLabel: "",
  generatedBy: "Hosam",
  ...over,
});

const table = (spec: ReportSpec, sheet: string, i = 0): ReportTable =>
  spec.sheets.find((s) => s.name === sheet)!.tables[i];
const kpi = (spec: ReportSpec, label: string) =>
  spec.sheets[0].kpis!.find((k) => k.label === label)!.value;

describe("teuOf", () => {
  it("counts 20ft as 1 TEU and 40/45ft as 2", () => {
    expect(teuOf("20GP")).toBe(1);
    expect(teuOf("20FT")).toBe(1);
    expect(teuOf("40HC")).toBe(2);
    expect(teuOf("45HC")).toBe(2);
    expect(teuOf("")).toBe(0);
  });
});

describe("buildInYardReport", () => {
  const visits = [
    visit({ gateInTime: daysAgo(35), containerType: "40HC" }),
    visit({ gateInTime: daysAgo(2), status: "reserved", bookingNumber: "BK/1" }),
    visit({ gateInTime: daysAgo(16), shippingLine: "SLD", containerType: "20RF" }),
    visit({ gateInTime: daysAgo(3), status: "out", gateOutTime: daysAgo(1) }),
  ];
  const spec = buildInYardReport(visits, ctx());

  it("includes in-yard and reserved containers but not gated-out ones", () => {
    expect(kpi(spec, "Containers on site")).toBe(3);
    expect(kpi(spec, "Reserved")).toBe(1);
    expect(kpi(spec, "Available (in yard)")).toBe(2);
    expect(kpi(spec, "TEU on site")).toBe(4);
    expect(kpi(spec, "Longest stay (days)")).toBe(35);
    expect(kpi(spec, "On site over 21 days")).toBe(1);
  });

  it("lists the detail oldest first with days on site and age band", () => {
    const rows = table(spec, "In-Yard Containers").rows;
    expect(rows.map((r) => r.days)).toEqual([35, 16, 2]);
    expect(rows[0].band).toBe("30+ days");
    expect(rows[1].band).toBe("15–21 days");
    expect(rows[2].status).toBe("Reserved");
    expect(rows[2].booking).toBe("BK/1");
  });

  it("splits stock by line and size, largest line first", () => {
    const stock = table(spec, "Summary", 0).rows;
    expect(stock[0]).toMatchObject({ line: "WOM", small: 1, hc: 1, total: 2, teu: 3, reserved: 1 });
    expect(stock[1]).toMatchObject({ line: "SLD", reefer: 1, total: 1 });
  });

  it("names the file after the yard code, like the hand-made report", () => {
    expect(spec.fileName).toBe("EVL_In-Yard_Report_2026-09-27.xlsx");
    expect(spec.meta[0]).toEqual(["Yard", "Everest Logistics Services"]);
  });

  it("adds a Yard column only when more than one yard is reported", () => {
    const single = table(spec, "In-Yard Containers").columns.map((c) => c.key);
    expect(single).not.toContain("yard");
    const multi = buildInYardReport([...visits, visit({ yardId: "y2" })], ctx());
    expect(table(multi, "In-Yard Containers").columns.map((c) => c.key)).toContain("yard");
    expect(multi.fileName.startsWith("ALL_")).toBe(true);
  });
});

describe("gate movements", () => {
  const period = { from: daysAgo(3, 0), to: new Date(2026, 8, 27, 23, 59, 59, 999) };
  const visits = [
    // In before the period, out inside it.
    visit({ gateInTime: daysAgo(10), gateOutTime: daysAgo(1, 14), status: "out", driverName: "IN DRIVER", gateOutDriverName: "OUT DRIVER", gateOutTruckNumber: "999", bookingNumber: "B1" }),
    // In inside the period, still on site.
    visit({ gateInTime: daysAgo(2, 20) }),
    // In and out inside the period.
    visit({ gateInTime: daysAgo(3, 8), gateOutTime: daysAgo(2, 8), status: "out", containerType: "40GP" }),
  ];

  it("emits one move per gate event inside the period, oldest first", () => {
    const moves = gateMoves(visits, period);
    expect(moves.map((m) => m.direction)).toEqual(["IN", "OUT", "IN", "OUT"]);
  });

  it("credits each move to its own driver and truck", () => {
    const v = visits[0];
    expect(moveCarrier({ at: v.gateInTime, direction: "IN", visit: v })).toEqual({ driver: "IN DRIVER", truck: "6088132" });
    expect(moveCarrier({ at: v.gateOutTime!, direction: "OUT", visit: v })).toEqual({ driver: "OUT DRIVER", truck: "999" });
  });

  it("falls back to the gate-in fields for a gate-out read before the gate-out columns existed", () => {
    const old = visit({ status: "out", gateOutTime: daysAgo(0), driverName: "LEGACY" });
    expect(moveCarrier({ at: old.gateOutTime!, direction: "OUT", visit: old }).driver).toBe("LEGACY");
  });

  it("summarises counts, net change, dwell and shifts", () => {
    const spec = buildMovementsReport(visits, ctx({ period }));
    expect(kpi(spec, "Gate-ins")).toBe(2);
    expect(kpi(spec, "Gate-outs")).toBe(2);
    expect(kpi(spec, "Net change")).toBe(0);
    expect(kpi(spec, "TEU in")).toBe(3);
    // Dwell: 9.2 days and 1 day → average 5.1
    expect(kpi(spec, "Average dwell of gated-out (days)")).toBe(5.1);
    const daily = table(spec, "Summary", 0).rows;
    expect(daily).toHaveLength(4); // 24, 25, 26, 27 Sep — quiet days included
    const shifts = table(spec, "Summary", 2).rows;
    expect(shifts[0]).toMatchObject({ in: 1, out: 2 }); // day shift
    expect(shifts[1]).toMatchObject({ in: 1, out: 0 }); // 20:00 gate-in is night
    const detail = table(spec, "Movements").rows;
    expect(detail.find((r) => r.move === "OUT" && r.booking === "B1")).toMatchObject({ driver: "OUT DRIVER", truck: "999" });
  });

  it("measures dwell in fractional days", () => {
    expect(dwellDays(daysAgo(2, 0), daysAgo(0, 12))).toBe(2.5);
  });
});

describe("buildFeesReport", () => {
  const pay = (over: Partial<ReportPayment>): ReportPayment => ({
    createdAt: daysAgo(1),
    yardId: "y1",
    containerNumber: "TEMU0000001",
    shippingLine: "WOM",
    chargeableDays: 2,
    demurrageAmount: 71.2,
    serviceFee: 10,
    totalCollected: 81.2,
    paymentMethod: "cash",
    transferred: false,
    ...over,
  });
  const payments = [
    pay({}),
    pay({ shippingLine: "SLD", demurrageAmount: 20, serviceFee: 5, totalCollected: 25, transferred: true, paymentMethod: "card" }),
    pay({ createdAt: daysAgo(40) }), // outside the period
  ];
  const visits = [visit({ status: "out", gateOutTime: daysAgo(1), fees: 12.5 })];
  const spec = buildFeesReport(visits, payments, ctx({ period: { from: daysAgo(7, 0) } }));

  it("splits demurrage owed to lines from the yard's service fees", () => {
    expect(kpi(spec, "Collected at the counter (JOD)")).toBe(106.2);
    expect(kpi(spec, "Demurrage owed to lines (JOD)")).toBe(91.2);
    expect(kpi(spec, "Yard service fees (JOD)")).toBe(15);
    expect(kpi(spec, "Demurrage not yet transferred (JOD)")).toBe(71.2);
    expect(kpi(spec, "Gate-out fees (JOD)")).toBe(12.5);
    expect(kpi(spec, "Demurrage payments")).toBe(2);
  });

  it("breaks totals down by line and by payment method", () => {
    const byLine = table(spec, "Summary", 0).rows;
    expect(byLine[0]).toMatchObject({ line: "WOM", total: 81.2, pending: 71.2, gateOutFees: 12.5 });
    const byMethod = table(spec, "Summary", 1).rows;
    expect(byMethod.map((r) => r.method)).toEqual(["card", "cash"]);
  });
});

describe("buildDriversReport", () => {
  const visits = [
    visit({ driverName: "Mohamad ", truckNumber: "1" }),
    visit({ driverName: "MOHAMAD", truckNumber: "2" }),
    visit({ driverName: "ALI", truckNumber: "1", status: "out", gateOutTime: daysAgo(0, 8), gateOutDriverName: "SAMI", gateOutTruckNumber: "3" }),
  ];
  const spec = buildDriversReport(visits, ctx());

  it("folds case and spacing so one driver is counted once", () => {
    expect(normalizeName("  abd   alaah ")).toBe("ABD ALAAH");
    const drivers = table(spec, "Drivers").rows;
    expect(drivers[0]).toMatchObject({ name: "MOHAMAD", total: 2, peers: "1, 2" });
  });

  it("counts the gate-in and gate-out drivers of one visit separately", () => {
    expect(kpi(spec, "Moves with a known driver")).toBe(4);
    const drivers = table(spec, "Drivers").rows;
    expect(drivers.find((d) => d.name === "ALI")).toMatchObject({ ins: 1, outs: 0 });
    expect(drivers.find((d) => d.name === "SAMI")).toMatchObject({ ins: 0, outs: 1, peers: "3" });
    const trucks = table(spec, "Trucks").rows;
    expect(trucks.find((t) => t.truck === "1")).toMatchObject({ total: 2, peers: "ALI, MOHAMAD" });
  });
});

describe("filters", () => {
  it("parses date inputs as local days, inclusive of the whole end day", () => {
    const p = periodFromFilters({ dateFrom: "2026-09-01", dateTo: "2026-09-02" });
    expect(p.from).toEqual(new Date(2026, 8, 1));
    expect(p.to).toEqual(new Date(2026, 8, 2, 23, 59, 59, 999));
    expect(periodFromFilters({ dateFrom: "", dateTo: "" })).toEqual({ from: undefined, to: undefined });
  });

  it("applies line, type and search like the Reports page", () => {
    const f = { dateFrom: "", dateTo: "", shippingLine: "WOM", containerType: "all", search: "hasan" };
    expect(matchesFilters(visit({}), f)).toBe(true);
    expect(matchesFilters(visit({ shippingLine: "SLD" }), f)).toBe(false);
    expect(matchesFilters(visit({ driverName: "ALI" }), f)).toBe(false);
    expect(filtersLabel(f)).toBe('Line WOM, Search "hasan"');
  });
});

describe("renderWorkbook", () => {
  const spec = buildInYardReport(
    [visit({ gateInTime: daysAgo(35) }), visit({ gateInTime: new Date(2026, 8, 24, 14, 24) })],
    ctx(),
  );

  it("round-trips through xlsx with styled, filterable, frozen sheets", async () => {
    const buffer = await renderWorkbook(spec).xlsx.writeBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as ArrayBuffer);

    expect(wb.worksheets.map((w) => w.name)).toEqual(["Summary", "In-Yard Containers"]);
    const ws = wb.getWorksheet("In-Yard Containers")!;
    expect(ws.getCell("A1").value).toBe("In-Yard Stock Report — In-Yard Containers");

    // Header row sits at row 4; data follows, then a SUBTOTAL totals row.
    expect(ws.getCell("C4").value).toBe("Container No.");
    expect(ws.views[0]).toMatchObject({ state: "frozen", ySplit: 4 });
    expect(ws.autoFilter).toBeTruthy();
    expect(ws.pageSetup.printTitlesRow).toBe("4:4");
    const total = ws.getCell("C7").value as ExcelJS.CellFormulaValue;
    expect(total.formula).toBe("SUBTOTAL(103,C5:C6)");
    expect(total.result).toBe(2);
    expect(ws.getCell("I5").value).toBe(35);
  });

  it("writes gate-in times as local wall-clock time", async () => {
    const buffer = await renderWorkbook(spec).xlsx.writeBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as ArrayBuffer);
    const cell = wb.getWorksheet("In-Yard Containers")!.getCell("H6").value as Date;
    // ExcelJS reads the serial back as a UTC instant — its UTC clock is the local wall clock.
    expect(cell.getUTCHours()).toBe(14);
    expect(cell.getUTCMinutes()).toBe(24);
    expect(toExcelLocal(new Date(2026, 0, 1, 9, 0)).getUTCHours()).toBe(9);
  });
});
