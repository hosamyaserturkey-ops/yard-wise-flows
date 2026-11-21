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
export function allowedActions(
  status: VisitStatus, departureInspectionClosed = true,
): { hold: boolean; release: boolean; gateOut: boolean } {
  return {
    hold: status === "in-lot",
    release: status === "on-hold",
    // A car on hold cannot leave until the hold is released, nor before its
    // departure inspection is closed (the database enforces both).
    gateOut: status === "in-lot" && departureInspectionClosed,
  };
}

/** Why the Gate out button is disabled, or undefined when it is not. */
export function gateOutBlockedReason(status: VisitStatus, departureInspectionClosed: boolean): string | undefined {
  if (status === "on-hold") return "Release the hold before gate-out";
  if (status === "in-lot" && !departureInspectionClosed) return "Close the departure inspection (Out) before gate-out";
  return undefined;
}

/** Plain-language message for the database errors of hold, edit and gate-out. */
export function carActionErrorMessage(error: { code?: string; message: string }): string {
  if (/close the departure inspection/i.test(error.message)) return "Close the departure inspection (Out) before gate-out.";
  if (/reason is required to put a car on hold/i.test(error.message)) return "Write why the car is put on hold.";
  if (/reason is required to change a VIN/i.test(error.message)) return "Write why the VIN is being changed.";
  if (/on hold; release the hold/i.test(error.message)) return "This car is on hold. Release the hold before gate-out.";
  if (/released car cannot be edited/i.test(error.message)) return "This car has already left the lot and cannot be edited.";
  if (/only the car lot's admin or the owner/i.test(error.message)) return "Only the car lot's admin can edit a car.";
  if (/free days must be/i.test(error.message)) return "Free days must be a whole number from 0 to 365.";
  if (error.code === "23505") return "A car with this VIN is already registered.";
  if (error.code === "42501" || /row-level security/i.test(error.message)) return "You are not allowed to do this.";
  return error.message;
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
