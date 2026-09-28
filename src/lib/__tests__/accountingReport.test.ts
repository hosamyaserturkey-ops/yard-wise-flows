import { describe, expect, it } from "vitest";
import { buildAccountingReport, type AccountingExportPayment } from "../accountingReport";

const NOW = new Date("2026-09-28T12:00:00Z");

const pay = (over: Partial<AccountingExportPayment>): AccountingExportPayment => ({
  id: "p",
  container_number: "MSCU1234567",
  shipping_line: "EEL",
  demurrage_amount: 100,
  service_fee: 7,
  total_collected: 107,
  payment_method: "cash",
  created_at: "2026-09-20T09:00:00Z",
  transferred: false,
  ...over,
});

describe("buildAccountingReport", () => {
  const spec = buildAccountingReport({
    payments: [
      pay({ id: "a" }),
      pay({ id: "b", shipping_line: "WOM", demurrage_amount: 40, total_collected: 47, payment_method: "qlick", created_at: "2026-07-01T09:00:00Z" }),
      pay({ id: "c", transferred: true }),
    ],
    transfers: [{ shipping_line: "EEL", amount_transferred: "100", transferred_at: "2026-09-21T10:00:00Z", reference: "TRX-1", payment_count: 1 }],
    periodLabel: "All dates",
    yardName: "Main Yard",
    generatedBy: "Accountant",
    now: NOW,
  });

  it("names the file by date and lists yard and period", () => {
    expect(spec.fileName).toBe("accounting-2026-09-28.xlsx");
    expect(spec.meta).toContainEqual(["Yard", "Main Yard"]);
    expect(spec.meta).toContainEqual(["Period", "All dates"]);
  });

  it("puts the headline figures on the summary sheet", () => {
    const kpis = Object.fromEntries(spec.sheets[0].kpis!.map((k) => [k.label, k.value]));
    expect(kpis).toEqual({
      "Total collected": 261,
      "Yard earnings (fees)": 21,
      "Owed to shipping lines": 140,
      "Transferred": 100,
    });
  });

  it("ages what each line is owed, pending payments only", () => {
    const rows = spec.sheets[0].tables[0].rows;
    expect(rows).toEqual([
      { line: "EEL", count: 1, d0: 0, d8: 100, d31: 0, d61: 0, owed: 100 },
      { line: "WOM", count: 1, d0: 0, d8: 0, d31: 0, d61: 40, owed: 40 },
    ]);
  });

  it("adds one daily-close column per payment method used", () => {
    const headers = spec.sheets[1].tables[0].columns.map((c) => c.header);
    expect(headers).toEqual(["Date", "Payments", "Cash", "Qlick", "Demurrage", "Service fees", "Total"]);
  });

  it("lists every payment and transfer", () => {
    expect(spec.sheets[2].tables[0].rows).toHaveLength(3);
    expect(spec.sheets[3].tables[0].rows[0]).toMatchObject({ line: "EEL", reference: "TRX-1", count: 1, amount: 100 });
  });
});
