import { describe, expect, it } from "vitest";
import {
  agingBucket, buildDailyClose, buildShippingLineBreakdown, formatJod, summarizePayments, shippingLineOwed,
  sumJod, yardEarned,
  type AccountingPayment,
} from "../accounting";

const make = (over: Partial<AccountingPayment> = {}): AccountingPayment => ({
  shipping_line: "EEL",
  demurrage_amount: 120,
  service_fee: 7,
  total_collected: 127,
  transferred: false,
  ...over,
});

describe("per-payment splits", () => {
  it("owes the full demurrage to the shipping line", () => {
    expect(shippingLineOwed(make({ demurrage_amount: 120 }))).toBe(120);
  });

  it("earns the yard the service fee only", () => {
    expect(yardEarned(make({ service_fee: 7 }))).toBe(7);
  });

  it("treats missing and non-numeric values as zero", () => {
    expect(shippingLineOwed(make({ demurrage_amount: null }))).toBe(0);
    expect(yardEarned(make({ service_fee: "not a number" }))).toBe(0);
  });

  it("reads numeric strings, as Supabase returns for numeric columns", () => {
    expect(shippingLineOwed(make({ demurrage_amount: "120.50" }))).toBe(120.5);
  });
});

describe("summarizePayments", () => {
  it("splits collections into yard fees and demurrage owed onward", () => {
    const summary = summarizePayments([
      make({ demurrage_amount: 120, service_fee: 7, total_collected: 127 }),
      make({ shipping_line: "WOM", demurrage_amount: 60, service_fee: 5, total_collected: 65 }),
    ]);
    expect(summary.totalCollected).toBe(192);
    expect(summary.yardEarnings).toBe(12);
    expect(summary.pendingTransfers).toBe(180);
  });

  it("excludes already transferred payments from pending, but not from earnings", () => {
    const summary = summarizePayments([
      make({ demurrage_amount: 120, service_fee: 7, total_collected: 127, transferred: true }),
      make({ demurrage_amount: 60, service_fee: 7, total_collected: 67 }),
    ]);
    expect(summary.pendingTransfers).toBe(60);
    expect(summary.yardEarnings).toBe(14);
    expect(summary.totalCollected).toBe(194);
  });

  it("returns zeros for no payments", () => {
    expect(summarizePayments([])).toEqual({
      totalCollected: 0, yardEarnings: 0, pendingTransfers: 0,
    });
  });
});

const NOW = new Date("2026-09-28T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();
const noAging = { days0to7: 0, days8to30: 0, days31to60: 0, days61plus: 0 };

describe("buildShippingLineBreakdown", () => {
  it("owes demurrage per line, not the service fee split", () => {
    const rows = buildShippingLineBreakdown(
      [
        make({ id: "a", shipping_line: "EEL", demurrage_amount: 120, service_fee: 7, created_at: daysAgo(1) }),
        make({ id: "b", shipping_line: "EEL", demurrage_amount: 80, service_fee: 7, created_at: daysAgo(3) }),
        make({ id: "c", shipping_line: "WOM", demurrage_amount: 45, service_fee: 5, created_at: daysAgo(2) }),
      ],
      [],
      NOW,
    );
    expect(rows).toEqual([
      {
        shipping_line: "EEL", count: 2, totalOwed: 200, transferred: false,
        paymentIds: ["a", "b"], oldestPendingAt: daysAgo(3), aging: { ...noAging, days0to7: 200 },
      },
      {
        shipping_line: "WOM", count: 1, totalOwed: 45, transferred: false,
        paymentIds: ["c"], oldestPendingAt: daysAgo(2), aging: { ...noAging, days0to7: 45 },
      },
    ]);
  });

  it("skips transferred payments, so settling covers only what is pending", () => {
    const rows = buildShippingLineBreakdown(
      [
        make({ id: "a", shipping_line: "EEL", demurrage_amount: 120, transferred: true }),
        make({ id: "b", shipping_line: "EEL", demurrage_amount: 80, created_at: daysAgo(0) }),
      ],
      ["EEL"],
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ count: 1, totalOwed: 80, paymentIds: ["b"], transferred: false });
  });

  it("keeps settled lines listed so their receipt stays reachable", () => {
    const rows = buildShippingLineBreakdown(
      [make({ shipping_line: "EEL", demurrage_amount: 120, transferred: true })],
      ["EEL", "WOM"],
      NOW,
    );
    expect(rows.map((r) => [r.shipping_line, r.count, r.totalOwed, r.transferred])).toEqual([
      ["EEL", 0, 0, true],
      ["WOM", 0, 0, true],
    ]);
  });

  it("ages what is owed by how long ago it was collected", () => {
    const [row] = buildShippingLineBreakdown(
      [
        make({ demurrage_amount: 10, created_at: daysAgo(7) }),
        make({ demurrage_amount: 20, created_at: daysAgo(8) }),
        make({ demurrage_amount: 30, created_at: daysAgo(45) }),
        make({ demurrage_amount: 40, created_at: daysAgo(90) }),
      ],
      [],
      NOW,
    );
    expect(row.aging).toEqual({ days0to7: 10, days8to30: 20, days31to60: 30, days61plus: 40 });
    expect(row.oldestPendingAt).toBe(daysAgo(90));
  });
});

describe("agingBucket", () => {
  it("puts bucket edges on the younger side", () => {
    expect(agingBucket(daysAgo(0), NOW)).toBe("days0to7");
    expect(agingBucket(daysAgo(30), NOW)).toBe("days8to30");
    expect(agingBucket(daysAgo(60), NOW)).toBe("days31to60");
    expect(agingBucket(daysAgo(61), NOW)).toBe("days61plus");
  });
});

describe("money precision", () => {
  it("sums to the fils without floating-point drift", () => {
    expect(sumJod(Array(10).fill(0.1))).toBe(1);
    expect(sumJod([0.1, 0.2])).toBe(0.3);
    expect(summarizePayments([
      make({ demurrage_amount: 0.1, service_fee: 0.2, total_collected: 0.3 }),
      make({ demurrage_amount: 0.2, service_fee: 0.1, total_collected: 0.3 }),
    ])).toEqual({ totalCollected: 0.6, yardEarnings: 0.3, pendingTransfers: 0.3 });
  });

  it("formats dinars with three decimals", () => {
    expect(formatJod(1234.5)).toBe("1,234.500 JOD");
    expect(formatJod("7")).toBe("7.000 JOD");
    expect(formatJod(null)).toBe("0.000 JOD");
  });
});

describe("buildDailyClose", () => {
  it("totals each local day by payment method, newest first", () => {
    const days = buildDailyClose([
      make({ created_at: new Date(2026, 8, 27, 9).toISOString(), payment_method: "cash", demurrage_amount: 100, service_fee: 7, total_collected: 107 }),
      make({ created_at: new Date(2026, 8, 27, 15).toISOString(), payment_method: "qlick", demurrage_amount: 50, service_fee: 7, total_collected: 57 }),
      make({ created_at: new Date(2026, 8, 28, 8).toISOString(), payment_method: "cash", demurrage_amount: 20, service_fee: 5, total_collected: 25 }),
    ]);
    expect(days).toEqual([
      { date: "2026-09-28", count: 1, demurrage: 20, fees: 5, total: 25, byMethod: { cash: 25 } },
      { date: "2026-09-27", count: 2, demurrage: 150, fees: 14, total: 164, byMethod: { cash: 107, qlick: 57 } },
    ]);
  });
});

describe("voided payments", () => {
  const voided = { voided_at: "2026-09-27T10:00:00Z" };

  it("count in no total", () => {
    expect(summarizePayments([
      make({ demurrage_amount: 100, service_fee: 7, total_collected: 107 }),
      make({ demurrage_amount: 50, service_fee: 7, total_collected: 57, ...voided }),
    ])).toEqual({ totalCollected: 107, yardEarnings: 7, pendingTransfers: 100 });
  });

  it("are never owed to the line or offered for settlement", () => {
    const rows = buildShippingLineBreakdown(
      [make({ id: "a", demurrage_amount: 100 }), make({ id: "b", demurrage_amount: 50, ...voided })],
      [],
      NOW,
    );
    expect(rows[0]).toMatchObject({ count: 1, totalOwed: 100, paymentIds: ["a"] });
  });

  it("stay out of the daily close", () => {
    expect(buildDailyClose([
      make({ created_at: new Date(2026, 8, 27, 9).toISOString(), total_collected: 107 }),
      make({ created_at: new Date(2026, 8, 27, 10).toISOString(), total_collected: 57, ...voided }),
    ])[0]).toMatchObject({ count: 1, total: 107 });
  });
});
