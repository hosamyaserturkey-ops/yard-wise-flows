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
