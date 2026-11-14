import type { Lang } from "@/i18n/messages";
import { MESSAGES } from "@/i18n/messages";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * "10 Nov 2026" / "10 تشرين الثاني 2026". Digits stay 0-9 in both languages (as
 * on the printed tickets), and the month name is written by hand so the result
 * never depends on the browser's ICU data.
 */
export function formatPortalDate(value: string | Date, lang: Lang): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  const month = MESSAGES[lang][`month.${d.getMonth() + 1}` as keyof typeof MESSAGES.en];
  return `${d.getDate()} ${month} ${d.getFullYear()}`;
}

export function formatPortalDateTime(value: string | Date, lang: Lang): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return `${formatPortalDate(d, lang)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
