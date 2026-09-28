// Shift calculation helpers.
// Day shift: 06:00–17:59 local time
// Night shift: 18:00–05:59 local time
export type WorkShift = "day" | "night";

export const DAY_SHIFT_START_HOUR = 6;
export const NIGHT_SHIFT_START_HOUR = 18;

export function shiftForDate(date: Date = new Date()): WorkShift {
  const h = date.getHours();
  return h >= DAY_SHIFT_START_HOUR && h < NIGHT_SHIFT_START_HOUR ? "day" : "night";
}

export function shiftLabel(shift: WorkShift): string {
  return shift === "day" ? "Day (06:00–18:00)" : "Night (18:00–06:00)";
}

/**
 * A shift is named by the date it started on: the night shift that began at
 * 18:00 on the 28th is still "28th night" at 02:00 on the 29th.
 */
export interface ShiftSlot {
  /** YYYY-MM-DD, local. */
  shiftDate: string;
  shift: WorkShift;
}

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function shiftSlotFor(date: Date = new Date()): ShiftSlot {
  const shift = shiftForDate(date);
  if (shift === "night" && date.getHours() < DAY_SHIFT_START_HOUR) {
    const prev = new Date(date.getFullYear(), date.getMonth(), date.getDate() - 1);
    return { shiftDate: ymd(prev), shift };
  }
  return { shiftDate: ymd(date), shift };
}

/** The shift before `slot`. */
export function previousShiftSlot(slot: ShiftSlot): ShiftSlot {
  if (slot.shift === "night") return { shiftDate: slot.shiftDate, shift: "day" };
  const [y, m, d] = slot.shiftDate.split("-").map(Number);
  return { shiftDate: ymd(new Date(y, m - 1, d - 1)), shift: "night" };
}
