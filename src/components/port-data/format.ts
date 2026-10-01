/** "2026-09-20" → "20 Sep 2026", read as a calendar day (no time-zone shift). */
export const fmtDay = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

/** Today's local calendar day as YYYY-MM-DD. */
export const todayLocalISO = (): string => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};
