// Builds the Accounting page's Excel export as a ReportSpec, rendered by
// src/lib/reports/workbook.ts like every other report.

import {
  buildDailyClose, buildShippingLineBreakdown, isActivePayment, shippingLineOwed, summarizePayments, sumJod, yardEarned,
  type AccountingPayment,
} from "./accounting";
import type { ReportSheet, ReportSpec } from "./reports/reportModel";

export interface AccountingExportPayment extends AccountingPayment {
  id: string;
  container_number: string;
  created_at: string;
}

export interface AccountingExportTransfer {
  shipping_line: string;
  amount_transferred: number | string;
  transferred_at: string;
  reference?: string | null;
  payment_count?: number | null;
  voided_at?: string | null;
  void_reason?: string | null;
}

export interface AccountingExportInput {
  payments: AccountingExportPayment[];
  transfers: AccountingExportTransfer[];
  /** e.g. "01 Sep 2026 – 28 Sep 2026", or "All dates". */
  periodLabel: string;
  yardName?: string;
  generatedBy?: string;
  now?: Date;
}

const METHOD_LABEL: Record<string, string> = { cash: "Cash", qlick: "Qlick" };
const methodLabel = (m: string) => METHOD_LABEL[m] ?? m;

export function buildAccountingReport(input: AccountingExportInput): ReportSpec {
  const now = input.now ?? new Date();
  const payments = input.payments.filter(isActivePayment);
  const transfers = input.transfers.filter((t) => !t.voided_at);
  const voidedPayments = input.payments.filter((p) => !isActivePayment(p));
  const voidedTransfers = input.transfers.filter((t) => t.voided_at);
  const summary = summarizePayments(payments);
  const lines = buildShippingLineBreakdown(payments, [], now);
  const days = buildDailyClose(payments);
  const methods = [...new Set(days.flatMap((d) => Object.keys(d.byMethod)))].sort();
  const stamp = now.toISOString().slice(0, 10);

  return {
    title: "Accounting Report",
    fileName: `accounting-${stamp}.xlsx`,
    meta: [
      ...(input.yardName ? [["Yard", input.yardName] as [string, string]] : []),
      ["Period", input.periodLabel],
      ["Generated", `${now.toLocaleString("en-GB")}${input.generatedBy ? ` by ${input.generatedBy}` : ""}`],
    ],
    sheets: [
      {
        name: "Summary",
        kpis: [
          { label: "Total collected", value: summary.totalCollected, format: "money" },
          { label: "Yard earnings (fees)", value: summary.yardEarnings, format: "money" },
          { label: "Owed to shipping lines", value: summary.pendingTransfers, format: "money" },
          { label: "Transferred", value: sumJod(transfers.map((t) => t.amount_transferred)), format: "money" },
        ],
        tables: [
          {
            title: "Owed to shipping lines, by age",
            totals: true,
            columns: [
              { key: "line", header: "Shipping line", width: 18, total: "label" },
              { key: "count", header: "Payments", width: 10, format: "int", total: "sum" },
              { key: "d0", header: "0–7 days", width: 13, format: "money", total: "sum" },
              { key: "d8", header: "8–30 days", width: 13, format: "money", total: "sum" },
              { key: "d31", header: "31–60 days", width: 13, format: "money", total: "sum" },
              { key: "d61", header: "61+ days", width: 13, format: "money", total: "sum" },
              { key: "owed", header: "Total owed", width: 14, format: "money", total: "sum" },
            ],
            rows: lines.map((l) => ({
              line: l.shipping_line,
              count: l.count,
              d0: l.aging.days0to7,
              d8: l.aging.days8to30,
              d31: l.aging.days31to60,
              d61: l.aging.days61plus,
              owed: l.totalOwed,
            })),
            note: "Age counts from the day the demurrage was collected at the gate.",
          },
        ],
      },
      {
        name: "Daily Close",
        detail: true,
        tables: [{
          totals: true,
          columns: [
            { key: "date", header: "Date", width: 14, format: "date", total: "label" },
            { key: "count", header: "Payments", width: 10, format: "int", total: "sum" },
            ...methods.map((m) => ({ key: `m_${m}`, header: methodLabel(m), width: 13, format: "money" as const, total: "sum" as const })),
            { key: "demurrage", header: "Demurrage", width: 13, format: "money", total: "sum" },
            { key: "fees", header: "Service fees", width: 13, format: "money", total: "sum" },
            { key: "total", header: "Total", width: 13, format: "money", total: "sum" },
          ],
          rows: days.map((d) => ({
            date: new Date(`${d.date}T00:00:00`),
            count: d.count,
            ...Object.fromEntries(methods.map((m) => [`m_${m}`, d.byMethod[m] ?? 0])),
            demurrage: d.demurrage,
            fees: d.fees,
            total: d.total,
          })),
        }],
      },
      {
        name: "Payments",
        detail: true,
        tables: [{
          totals: true,
          columns: [
            { key: "date", header: "Collected", width: 18, format: "datetime", total: "label" },
            { key: "container", header: "Container", width: 14 },
            { key: "line", header: "Line", width: 10 },
            { key: "method", header: "Method", width: 9 },
            { key: "demurrage", header: "Demurrage", width: 13, format: "money", total: "sum" },
            { key: "fee", header: "Service fee", width: 13, format: "money", total: "sum" },
            { key: "total", header: "Total", width: 13, format: "money", total: "sum" },
            { key: "status", header: "Status", width: 12 },
          ],
          rows: payments.map((p) => ({
            date: new Date(p.created_at),
            container: p.container_number,
            line: p.shipping_line,
            method: methodLabel(p.payment_method || "unknown"),
            demurrage: shippingLineOwed(p),
            fee: yardEarned(p),
            total: Number(p.total_collected ?? 0) || 0,
            status: p.transferred ? "Transferred" : "Pending",
          })),
        }],
      },
      {
        name: "Transfers",
        detail: true,
        tables: [{
          totals: true,
          columns: [
            { key: "date", header: "Transferred", width: 18, format: "datetime", total: "label" },
            { key: "line", header: "Line", width: 10 },
            { key: "reference", header: "Reference", width: 20 },
            { key: "count", header: "Payments", width: 10, format: "int", total: "sum" },
            { key: "amount", header: "Amount", width: 14, format: "money", total: "sum" },
          ],
          rows: transfers.map((t) => ({
            date: new Date(t.transferred_at),
            line: t.shipping_line,
            reference: t.reference ?? "",
            count: t.payment_count ?? null,
            amount: Number(t.amount_transferred) || 0,
          })),
        }],
      },
      ...(voidedPayments.length || voidedTransfers.length ? [voidedSheet(voidedPayments, voidedTransfers)] : []),
    ],
  };
}

/** Voided items, kept apart so no totals row ever counts them. */
function voidedSheet(payments: AccountingExportPayment[], transfers: AccountingExportTransfer[]): ReportSheet {
  return {
    name: "Voided",
    tables: [
      {
        title: "Voided payments (refunded — not counted anywhere)",
        columns: [
          { key: "date", header: "Collected", width: 18, format: "datetime" },
          { key: "container", header: "Container", width: 14 },
          { key: "line", header: "Line", width: 10 },
          { key: "total", header: "Total", width: 13, format: "money" },
          { key: "voided", header: "Voided", width: 18, format: "datetime" },
          { key: "reason", header: "Reason", width: 36 },
        ],
        rows: payments.map((p) => ({
          date: new Date(p.created_at),
          container: p.container_number,
          line: p.shipping_line,
          total: Number(p.total_collected ?? 0) || 0,
          voided: p.voided_at ? new Date(p.voided_at) : null,
          reason: p.void_reason ?? "",
        })),
      },
      {
        title: "Voided transfers (their payments went back to pending)",
        columns: [
          { key: "date", header: "Transferred", width: 18, format: "datetime" },
          { key: "line", header: "Line", width: 10 },
          { key: "reference", header: "Reference", width: 20 },
          { key: "amount", header: "Amount", width: 14, format: "money" },
          { key: "voided", header: "Voided", width: 18, format: "datetime" },
          { key: "reason", header: "Reason", width: 36 },
        ],
        rows: transfers.map((t) => ({
          date: new Date(t.transferred_at),
          line: t.shipping_line,
          reference: t.reference ?? "",
          amount: Number(t.amount_transferred) || 0,
          voided: t.voided_at ? new Date(t.voided_at) : null,
          reason: t.void_reason ?? "",
        })),
      },
    ],
  };
}
