// Pure helpers for the Gate Out screen. Kept out of the page component so the
// search, dwell-time and money rules can be unit-tested without React.

import type { Container } from "@/types/container";

/** Whole 24h periods the container has been in the yard. */
export function dwellDays(gateInTime: Date, now: Date = new Date()): number {
  const ms = now.getTime() - gateInTime.getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor(ms / 86_400_000));
}

/** Short human label for a dwell time, e.g. "Today", "1 day", "12 days". */
export function formatDwell(days: number): string {
  if (days <= 0) return "Today";
  return `${days} day${days === 1 ? "" : "s"}`;
}

/**
 * Free-text match over everything the row actually shows: container number,
 * both drivers/trucks, booking, line and type. The old filter only looked at
 * container/driver/truck, so searching a booking number found nothing.
 */
export function matchesGateOutSearch(container: Container, term: string): boolean {
  const q = term.trim().toLowerCase();
  if (!q) return true;
  return [
    container.containerNumber,
    container.driverName,
    container.truckNumber,
    container.bookingNumber,
    container.shippingLine,
    container.containerType,
  ].some((field) => (field ?? "").toLowerCase().includes(q));
}

/**
 * Parses the fees field. JOD is quoted to three decimals (fils), which is what
 * the printed ticket shows, so the amount is rounded to 3 places rather than 2.
 * Returns null when the input is not a usable amount.
 */
export function normalizeFees(raw: string): number | null {
  const value = raw.trim();
  if (!value) return null;
  const num = Number(value);
  if (!Number.isFinite(num) || num < 0) return null;
  return Math.round(num * 1000) / 1000;
}

/** Formats an amount the way the gate-out ticket does. */
export function formatJod(amount: number): string {
  return amount.toLocaleString("en", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}
