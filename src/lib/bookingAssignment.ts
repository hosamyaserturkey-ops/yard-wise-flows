// How far each booking is along in getting containers assigned — pure, no
// React, no Supabase. The bookings list filters on it.
//
// A container is assigned to a booking from the moment it's reserved against
// it, and stays counted once it has gated out on it. Reserved containers come
// from container_visits; gated-out ones from the booking's own counter, the
// same number the list's "Gated out" column shows.

import type { Booking } from "@/types/booking";

export const ASSIGNMENT_FILTERS = ["any", "unassigned", "partial", "full", "reserved"] as const;
export type AssignmentFilter = (typeof ASSIGNMENT_FILTERS)[number];

export const ASSIGNMENT_FILTER_LABELS: Record<AssignmentFilter, string> = {
  any: "Any assignment",
  unassigned: "No containers assigned",
  partial: "Partly assigned",
  full: "Fully assigned",
  reserved: "Reserved, waiting to gate out",
};

export type AssignmentState = "unassigned" | "partial" | "full";

type AssignableBooking = Pick<Booking, "total_containers" | "gated_out_containers">;

/** Reserved visits per booking id; visits with no booking are skipped. */
export function countReservedByBooking(visits: { booking_id: string | null }[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const { booking_id } of visits) {
    if (booking_id) counts.set(booking_id, (counts.get(booking_id) ?? 0) + 1);
  }
  return counts;
}

/** Containers reserved or gated out against the booking. */
export const assignedCount = (booking: AssignableBooking, reserved: number): number =>
  reserved + booking.gated_out_containers;

export function assignmentState(booking: AssignableBooking, reserved: number): AssignmentState {
  const assigned = assignedCount(booking, reserved);
  if (assigned === 0) return "unassigned";
  return assigned >= booking.total_containers ? "full" : "partial";
}

export function matchesAssignmentFilter(
  booking: AssignableBooking,
  reserved: number,
  filter: AssignmentFilter,
): boolean {
  if (filter === "any") return true;
  if (filter === "reserved") return reserved > 0;
  return assignmentState(booking, reserved) === filter;
}
