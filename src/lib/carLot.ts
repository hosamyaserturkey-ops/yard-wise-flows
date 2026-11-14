export type VisitStatus = "in-lot" | "on-hold" | "out";

export const VISIT_STATUS_LABEL: Record<VisitStatus, string> = {
  "in-lot": "In lot",
  "on-hold": "On hold",
  out: "Released",
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days a car has been (or was) in the lot; the day it arrived counts as day 1. */
export function daysInLot(gateIn: string | Date, now: Date, gateOut?: string | Date | null): number {
  const start = new Date(gateIn).getTime();
  const end = gateOut ? new Date(gateOut).getTime() : now.getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return 1;
  return Math.floor((end - start) / DAY_MS) + 1;
}

/** Days beyond the free days, for the car-lot screens (no money is calculated yet). */
export function daysOverFree(daysIn: number, freeDays: number): number {
  return Math.max(0, daysIn - freeDays);
}

/** What a user may do to a visit; the database enforces the same rules. */
export function allowedActions(status: VisitStatus): { hold: boolean; release: boolean; gateOut: boolean } {
  return {
    hold: status === "in-lot",
    release: status === "on-hold",
    // A car on hold cannot leave until the hold is released.
    gateOut: status === "in-lot",
  };
}

/** The message for the database errors a gate-in can run into, so staff are not shown raw SQL text. */
export function gateInErrorMessage(error: { code?: string; message: string }): string {
  if (error.code === "23505" && /one_open_per_vehicle/.test(error.message)) {
    return "This car is already in the lot.";
  }
  if (error.code === "23505") return "A car with this VIN is already registered.";
  if (error.code === "42501" || /row-level security/i.test(error.message)) {
    return "You are not allowed to register cars here.";
  }
  return error.message;
}
