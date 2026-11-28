import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const API_MAX_ROWS = 1000;

const valueAt = (row: Row, path: string): unknown =>
  path.split(".").reduce<unknown>((v, k) => (v as Row | null | undefined)?.[k], row);

/** Minimal PostgREST stand-in: applies the filters, and like the real API never
 *  returns more than 1,000 rows from one request. */
function from(table: string) {
  const filters: ((r: Row) => boolean)[] = [];
  const orders: { col: string; asc: boolean }[] = [];
  const q = {
    select: () => q,
    eq: (c: string, v: unknown) => (filters.push((r) => valueAt(r, c) === v), q),
    neq: (c: string, v: unknown) => (filters.push((r) => valueAt(r, c) !== v), q),
    is: (c: string, v: unknown) => (filters.push((r) => valueAt(r, c) === v), q),
    not: (c: string, _op: string, v: unknown) => (filters.push((r) => valueAt(r, c) !== v), q),
    in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(valueAt(r, c))), q),
    order: (col: string, o?: { ascending?: boolean }) => (orders.push({ col, asc: o?.ascending ?? true }), q),
    range: async (lo: number, hi: number) => {
      const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      rows.sort((a, b) => {
        for (const { col, asc } of orders) {
          const x = String(valueAt(a, col)), y = String(valueAt(b, col));
          if (x !== y) return (x < y ? -1 : 1) * (asc ? 1 : -1);
        }
        return 0;
      });
      return { data: rows.slice(lo, Math.min(hi + 1, lo + API_MAX_ROWS)), error: null };
    },
    // A select awaited without .range() still stops at 1,000 rows.
    then: (resolve: (v: unknown) => void) =>
      resolve({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))).slice(0, API_MAX_ROWS), error: null }),
  };
  return q;
}

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from } }));

const { approvedNotInYard, unspentApprovals, fetchPendingGateIns } = await import("../pendingGateIns");

const YARD = "yard-a";
let seq = 0;
const check = (container_number: string, created_at: string, status = "approved", yard_id = YARD) => ({
  id: `chk-${++seq}`, yard_id, container_number, container_type: "40HC", grade: "A", status, notes: null, created_at,
});
const visit = (container_number: string, gate_out_time: string | null, yard_id = YARD) => ({
  id: String(++seq).padStart(6, "0"), yard_id, gate_out_time, containers: { container_number },
});

describe("approvedNotInYard", () => {
  it("judges each box by its latest check only", () => {
    const rows = [
      check("AAAU1111111", "2026-11-27T10:00:00Z", "rejected"),
      check("AAAU1111111", "2026-11-26T10:00:00Z", "approved"),
      check("BBBU2222222", "2026-11-27T09:00:00Z", "approved"),
    ];
    expect(approvedNotInYard(rows, new Set()).map((c) => c.container_number)).toEqual(["BBBU2222222"]);
  });

  it("leaves out boxes that are in the yard", () => {
    const rows = [check("AAAU1111111", "2026-11-27T10:00:00Z")];
    expect(approvedNotInYard(rows, new Set(["AAAU1111111"]))).toEqual([]);
  });
});

describe("unspentApprovals", () => {
  it("drops an approval from before the box's last gate-out, keeps one from after", () => {
    const old = check("AAAU1111111", "2026-11-01T10:00:00Z");
    const fresh = check("BBBU2222222", "2026-11-20T10:00:00Z");
    const out = new Map([
      ["AAAU1111111", "2026-11-10T10:00:00Z"],
      ["BBBU2222222", "2026-11-10T10:00:00Z"],
    ]);
    expect(unspentApprovals([old, fresh], out).map((p) => p.container_number)).toEqual(["BBBU2222222"]);
  });
});

describe("fetchPendingGateIns", () => {
  beforeEach(() => {
    seq = 0;
    for (const k of Object.keys(tables)) delete tables[k];
  });

  it("drops boxes gated in after the yard passed 1,000 visits", async () => {
    // 1,000 older visits, then 11 new gate-ins of approved boxes: the case
    // where the newest 11 fell off the end of a single unpaged select.
    const older = Array.from({ length: 1000 }, (_, i) =>
      visit(`OLDU${String(i).padStart(7, "0")}`, i % 4 === 0 ? "2026-10-01T00:00:00Z" : null));
    const newNumbers = Array.from({ length: 11 }, (_, i) => `NEWU${String(i).padStart(7, "0")}`);
    tables.container_visits = [...older, ...newNumbers.map((n) => visit(n, null))];
    tables.inspector_checks = [
      ...newNumbers.map((n) => check(n, "2026-11-27T12:00:00Z")),
      check("WAITU000001", "2026-11-27T13:00:00Z"),
    ];

    const pending = await fetchPendingGateIns(YARD);
    expect(pending.map((p) => p.container_number)).toEqual(["WAITU000001"]);
  });

  it("still lists approvals once there are more than 1,000 checks", async () => {
    tables.container_visits = [];
    tables.inspector_checks = [
      check("WAITU000001", "2026-01-01T00:00:00Z"),
      ...Array.from({ length: 1000 }, (_, i) =>
        check(`REJU${String(i).padStart(7, "0")}`, "2026-11-27T12:00:00Z", "rejected")),
    ];

    const pending = await fetchPendingGateIns(YARD);
    expect(pending.map((p) => p.container_number)).toEqual(["WAITU000001"]);
  });

  it("keeps a box returning on a new trip, drops one whose approval was spent", async () => {
    tables.container_visits = [
      visit("BACKU000001", "2026-11-10T00:00:00Z"),
      visit("DONEU000001", "2026-11-10T00:00:00Z"),
    ];
    tables.inspector_checks = [
      check("BACKU000001", "2026-11-20T00:00:00Z"),
      check("DONEU000001", "2026-11-01T00:00:00Z"),
    ];

    const pending = await fetchPendingGateIns(YARD);
    expect(pending.map((p) => p.container_number)).toEqual(["BACKU000001"]);
  });

  it("ignores cancelled checks, other yards and other yards' visits", async () => {
    tables.container_visits = [visit("OTHRU000001", null, "yard-b")];
    tables.inspector_checks = [
      check("CANCU000001", "2026-11-27T00:00:00Z", "cancelled"),
      check("ELSEU000001", "2026-11-27T00:00:00Z", "approved", "yard-b"),
      check("OTHRU000001", "2026-11-27T00:00:00Z"),
    ];

    const pending = await fetchPendingGateIns(YARD);
    expect(pending.map((p) => p.container_number)).toEqual(["OTHRU000001"]);
  });
});
