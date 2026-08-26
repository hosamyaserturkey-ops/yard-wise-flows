/**
 * Accounting math for demurrage collections.
 *
 * The yard collects two things at the gate: the demurrage the shipping line
 * charges for the container's overstay, and the yard's own service fee.
 *
 *   total_collected = demurrage_amount + service_fee
 *
 * Demurrage is collected on the shipping line's behalf — every fils of it is
 * owed onward to that line. The service fee is what the yard actually earns.
 * The stored `yard_share` / `shipping_line_share` columns predate that rule
 * (they split the service fee instead), so everything here is derived from
 * `demurrage_amount` and `service_fee` and older rows report correctly too.
 */

export interface AccountingPayment {
  shipping_line: string;
  demurrage_amount: number | string | null;
  service_fee: number | string | null;
  total_collected: number | string | null;
  transferred: boolean;
}

export interface AccountingSummary {
  /** Everything taken at the counter: demurrage + service fees. */
  totalCollected: number;
  /** The yard's own revenue — service fees only. */
  yardEarnings: number;
  /** Demurrage collected but not yet transferred to the shipping lines. */
  pendingTransfers: number;
}

export interface ShippingLineOwed {
  shipping_line: string;
  /** Untransferred payments for this line. */
  count: number;
  /** Demurrage owed onward to this line. */
  totalOwed: number;
  transferred: boolean;
}

const amount = (value: number | string | null | undefined): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

/** Demurrage owed to the shipping line for a single payment. */
export const shippingLineOwed = (payment: AccountingPayment): number =>
  amount(payment.demurrage_amount);

/** Yard revenue from a single payment — the service fee, nothing else. */
export const yardEarned = (payment: AccountingPayment): number =>
  amount(payment.service_fee);

export const summarizePayments = (payments: AccountingPayment[]): AccountingSummary =>
  payments.reduce<AccountingSummary>(
    (acc, p) => ({
      totalCollected: acc.totalCollected + amount(p.total_collected),
      yardEarnings: acc.yardEarnings + yardEarned(p),
      pendingTransfers: acc.pendingTransfers + (p.transferred ? 0 : shippingLineOwed(p)),
    }),
    { totalCollected: 0, yardEarnings: 0, pendingTransfers: 0 },
  );

/**
 * Per-line demurrage still owed. Lines with a recorded transfer but nothing
 * outstanding are listed as settled so their receipt stays reachable.
 */
export const buildShippingLineBreakdown = (
  payments: AccountingPayment[],
  transferredLines: Iterable<string>,
): ShippingLineOwed[] => {
  const pending = new Map<string, { count: number; totalOwed: number }>();
  payments.forEach((p) => {
    if (p.transferred) return;
    const existing = pending.get(p.shipping_line) || { count: 0, totalOwed: 0 };
    existing.count += 1;
    existing.totalOwed += shippingLineOwed(p);
    pending.set(p.shipping_line, existing);
  });

  const rows: ShippingLineOwed[] = [];
  pending.forEach((v, k) => rows.push({ shipping_line: k, ...v, transferred: false }));
  for (const line of transferredLines) {
    if (!pending.has(line)) {
      rows.push({ shipping_line: line, count: 0, totalOwed: 0, transferred: true });
    }
  }
  return rows;
};
