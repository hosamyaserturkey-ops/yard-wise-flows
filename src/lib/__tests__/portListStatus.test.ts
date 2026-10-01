import { describe, expect, it } from "vitest";
import { buildPortListReport, buildPortListRows, summarizePortList, type PortListEntry, type VisitLite } from "../portListStatus";

const d = (iso: string) => new Date(`${iso}T12:00:00`);

const entry = (container_number: string, port_arrival_date: string, extra: Partial<PortListEntry> = {}): PortListEntry => ({
  container_number,
  shipping_line: "WOM",
  container_type: "20GP",
  port_arrival_date,
  free_days: 21,
  ...extra,
});

const visit = (gate_in: string, extra: Partial<VisitLite> = {}): VisitLite => ({
  gate_in_time: `${gate_in}T09:00:00+03:00`,
  gate_out_time: null,
  port_arrival_date: null,
  free_days: 21,
  ...extra,
});

describe("buildPortListRows", () => {
  const TODAY = d("2026-10-05");

  it("marks a container still out and counts demurrage to today", () => {
    // 12 Sep arrival, 21 free days → last free day 2 Oct; 5 Oct is 3 days over.
    const [row] = buildPortListRows([entry("TEMU4267243", "2026-09-12")], new Map(), TODAY);
    expect(row).toMatchObject({ status: "awaiting", lastFreeDay: "2026-10-02", daysOver: 3, demurrageUSD: 150, gateInTime: null });
  });

  it("stops the clock at this trip's gate-in", () => {
    const visits = new Map([["TEMU4267243", [visit("2026-10-03")]]]);
    const [row] = buildPortListRows([entry("TEMU4267243", "2026-09-12")], visits, TODAY);
    expect(row.status).toBe("in_yard");
    expect(row.daysOver).toBe(1);
    expect(row.demurrageUSD).toBe(50);
  });

  it("ignores a gate-in from an earlier trip", () => {
    const visits = new Map([["TEMU4267243", [visit("2026-05-01", { gate_out_time: "2026-05-20T10:00:00+03:00" })]]]);
    const [row] = buildPortListRows([entry("TEMU4267243", "2026-09-12")], visits, TODAY);
    expect(row.status).toBe("awaiting");
  });

  it("reports a gated-out container", () => {
    const visits = new Map([["ZONU0248142", [visit("2026-09-28", { gate_out_time: "2026-10-01T10:00:00+03:00" })]]]);
    const [row] = buildPortListRows([entry("ZONU0248142", "2026-09-20")], visits, TODAY);
    expect(row.status).toBe("gated_out");
    expect(row.gateOutTime).toEqual(new Date("2026-10-01T10:00:00+03:00"));
    expect(row.daysOver).toBe(0);
  });

  it("uses the list's free days", () => {
    const [row] = buildPortListRows([entry("TEMU4267243", "2026-09-12", { free_days: 30 })], new Map(), TODAY);
    expect(row.lastFreeDay).toBe("2026-10-11");
    expect(row.daysOver).toBe(0);
  });

  it("flags a gate-in recorded with a different arrival date or free days", () => {
    const visits = new Map([
      ["CAXU6278040", [visit("2026-09-28", { port_arrival_date: "2026-09-20" })]],
      ["FTAU1920261", [visit("2026-09-27", { port_arrival_date: "2026-09-12", free_days: 7 })]],
      ["ZONU0248142", [visit("2026-09-28", { port_arrival_date: "2026-09-20" })]],
    ]);
    const rows = buildPortListRows(
      [entry("CAXU6278040", "2026-09-12"), entry("FTAU1920261", "2026-09-12"), entry("ZONU0248142", "2026-09-20")],
      visits,
      TODAY,
    );
    expect(rows.map((r) => [r.recordedArrival, r.recordedFreeDays])).toEqual([
      ["2026-09-20", null],
      [null, 7],
      [null, null],
    ]);
  });
});

describe("summarizePortList", () => {
  it("counts each status and totals what the overdue ones owe", () => {
    const visits = new Map([
      ["A", [visit("2026-09-28")]],
      ["B", [visit("2026-09-28", { gate_out_time: "2026-10-01T10:00:00+03:00", port_arrival_date: "2026-09-20" })]],
    ]);
    const rows = buildPortListRows(
      [
        entry("A", "2026-09-12"),
        entry("B", "2026-09-12"),
        entry("C", "2026-09-12"), // out, 3 days over → $150
        entry("D", "2026-09-12", { container_type: "40HC" }), // out, 3 days over → $300
        entry("E", "2026-09-20"), // out, within free time
      ],
      visits,
      d("2026-10-05"),
    );
    expect(summarizePortList(rows)).toEqual({
      listed: 5,
      awaiting: 3,
      overdue: 2,
      overdueUSD: 450,
      overdueJOD: 320.4,
      inYard: 1,
      gatedOut: 1,
      mismatched: 1,
    });
  });
});

describe("buildPortListReport", () => {
  it("lays the rows out like the line's sheet", () => {
    const rows = buildPortListRows([entry("TEMU4267243", "2026-09-12")], new Map(), d("2026-10-05"));
    const spec = buildPortListReport(rows, {
      title: "WOM port list",
      yard: "EVL",
      generatedBy: "Admin",
      filter: "All",
      asOf: d("2026-10-05"),
      fileName: "wom.xlsx",
    });
    const [table] = spec.sheets[0].tables;
    expect(table.rows[0]).toMatchObject({
      container: "TEMU4267243",
      arrival: new Date(2026, 8, 12),
      free: 21,
      lfd: new Date(2026, 9, 2),
      status: "Not returned — past free time",
      daysOver: 3,
      usd: 150,
    });
    expect(spec.sheets[0].kpis?.find((k) => k.label === "Past free time")?.value).toBe(1);
  });
});

describe("buildPortListRows — yards", () => {
  it("only counts a visit at the same yard as the list row", () => {
    const visits = new Map([["TEMU4267243", [visit("2026-10-01", { yard_id: "yard-b" })]]]);
    const [a, b] = buildPortListRows(
      [entry("TEMU4267243", "2026-09-12", { yard_id: "yard-a" }), entry("TEMU4267243", "2026-09-12", { yard_id: "yard-b" })],
      visits,
      d("2026-10-05"),
    );
    expect(a.status).toBe("awaiting");
    expect(b.status).toBe("in_yard");
  });
});
