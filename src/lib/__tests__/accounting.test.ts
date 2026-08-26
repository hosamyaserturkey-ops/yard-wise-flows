import { describe, expect, it } from "vitest";
import {
  buildShippingLineBreakdown, summarizePayments, shippingLineOwed, yardEarned,
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

describe("buildShippingLineBreakdown", () => {
  it("owes demurrage per line, not the service fee split", () => {
    const rows = buildShippingLineBreakdown(
      [
        make({ shipping_line: "EEL", demurrage_amount: 120, service_fee: 7 }),
        make({ shipping_line: "EEL", demurrage_amount: 80, service_fee: 7 }),
        make({ shipping_line: "WOM", demurrage_amount: 45, service_fee: 5 }),
      ],
      [],
    );
    expect(rows).toEqual([
      { shipping_line: "EEL", count: 2, totalOwed: 200, transferred: false },
      { shipping_line: "WOM", count: 1, totalOwed: 45, transferred: false },
    ]);
  });

  it("skips transferred payments", () => {
    const rows = buildShippingLineBreakdown(
      [
        make({ shipping_line: "EEL", demurrage_amount: 120, transferred: true }),
        make({ shipping_line: "EEL", demurrage_amount: 80 }),
      ],
      ["EEL"],
    );
    expect(rows).toEqual([{ shipping_line: "EEL", count: 1, totalOwed: 80, transferred: false }]);
  });

  it("keeps settled lines listed so their receipt stays reachable", () => {
    const rows = buildShippingLineBreakdown(
      [make({ shipping_line: "EEL", demurrage_amount: 120, transferred: true })],
      ["EEL", "WOM"],
    );
    expect(rows).toEqual([
      { shipping_line: "EEL", count: 0, totalOwed: 0, transferred: true },
      { shipping_line: "WOM", count: 0, totalOwed: 0, transferred: true },
    ]);
  });
});
