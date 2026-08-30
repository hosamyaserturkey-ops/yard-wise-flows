// Which bookings a container may be reserved or gated out against.
//
// A booking belongs to one shipping line. Offering an EEL container a WOM
// booking lets an operator release a box against a booking the line never
// shipped — and bumps that line's gated-out counter for it. These helpers are
// the single rule both the gate-out form and the reserve dialog filter on.

import type { Booking } from "@/types/booking";

/**
 * Case-insensitive line comparison. Codes are stored as shipping_lines spells
 * them, which is mixed case for some lines ('7Seas', 'Gezairi') — comparing
 * them exactly is what once hid a rep's whole yard from them.
 */
const sameLine = (a: string, b: string) => a.trim().toUpperCase() === b.trim().toUpperCase();

/**
 * True when `booking` may be used for a container on `containerLine`.
 *
 * A booking with no line on file (legacy: created before bookings carried one,
 * and never linked to a container the line could be inferred from) matches any
 * line rather than becoming unusable. New bookings always carry a line.
 */
export function bookingMatchesLine(
  booking: Pick<Booking, "shipping_line">,
  containerLine: string | null | undefined,
): boolean {
  if (!booking.shipping_line) return true;
  if (!containerLine) return false;
  return sameLine(booking.shipping_line, containerLine);
}

/** The subset of `bookings` selectable for a container on `containerLine`. */
export function bookingsForLine(
  bookings: Booking[],
  containerLine: string | null | undefined,
): Booking[] {
  return bookings.filter((booking) => bookingMatchesLine(booking, containerLine));
}

/** Dropdown label: number, customer, progress, and a flag when no line is set. */
export function bookingOptionLabel(booking: Booking): string {
  const progress = `${booking.gated_out_containers}/${booking.total_containers} out`;
  const line = booking.shipping_line ? booking.shipping_line : "line not set";
  return `${booking.booking_number} — ${booking.customer_name} (${line}, ${progress})`;
}
