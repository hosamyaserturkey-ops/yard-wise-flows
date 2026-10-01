// One date/time style for the whole app: "01 Oct 2026", "01 Oct 2026, 22:07".
// Built by hand rather than with toLocaleDateString so the result never
// depends on the browser's language (en-US would print 10/1/2026) or ICU
// version (en-GB prints "Sept" in newer engines).

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export type DateLike = Date | string | number;

const pad = (n: number) => String(n).padStart(2, "0");

/** Parses a value into a Date. A bare "YYYY-MM-DD" is read as a local calendar day, not UTC midnight. */
export const toDate = (value: DateLike): Date => {
  if (value instanceof Date) return value;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [y, m, d] = value.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  return new Date(value);
};

/** "01 Oct 2026" */
export const formatDate = (value: DateLike): string => {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};

/** "22:07" (24-hour, as on the printed receipts) */
export const formatTime = (value: DateLike): string => {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** "01 Oct 2026, 22:07" */
export const formatDateTime = (value: DateLike): string => {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${formatDate(d)}, ${formatTime(d)}`;
};

/** "01 Oct" — for compact lists where the year is obvious. */
export const formatDayMonth = (value: DateLike): string => {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${pad(d.getDate())} ${MONTHS[d.getMonth()]}`;
};

/** "Wed, 01 Oct 2026" (or "Wed, 01 Oct" without the year) */
export const formatWeekdayDate = (value: DateLike, withYear = true): string => {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${WEEKDAYS[d.getDay()]}, ${withYear ? formatDate(d) : formatDayMonth(d)}`;
};

/** "October 2026" */
export const formatMonthYear = (value: DateLike): string => {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;
};

/** "Oct 26" — chart axis labels. */
export const formatMonthShort = (value: DateLike): string => {
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${MONTHS[d.getMonth()]} ${String(d.getFullYear()).slice(-2)}`;
};

const validDay = (y: number, m: number, d: number): Date | null => {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? date : null;
};

/**
 * Reads what someone typed into a date box. Day comes first, as written in
 * Jordan: "01/10/2026", "1-10-26", "01.10.2026", "01102026", "1 Oct 2026".
 * "2026-10-01" is also accepted. Returns "YYYY-MM-DD", or null if it isn't a
 * real calendar day.
 */
export const parseDateInput = (text: string): string | null => {
  const s = text.trim();
  if (!s) return null;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) {
    const d = validDay(+m[1], +m[2], +m[3]);
    return d ? toIsoDay(d) : null;
  }
  m = s.match(/^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{2}|\d{4})$/) ?? s.match(/^(\d{2})(\d{2})(\d{4})$/);
  if (m) {
    const year = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const d = validDay(year, +m[2], +m[1]);
    return d ? toIsoDay(d) : null;
  }
  m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,})\.?[\s-,]+(\d{4})$/);
  if (m) {
    const name = m[2].slice(0, 3).toLowerCase();
    const month = MONTHS.findIndex((x) => x.toLowerCase() === name);
    if (month < 0) return null;
    const d = validDay(+m[3], month + 1, +m[1]);
    return d ? toIsoDay(d) : null;
  }
  return null;
};

/** Date -> "YYYY-MM-DD" in local time (the value format date filters use). */
export const toIsoDay = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
