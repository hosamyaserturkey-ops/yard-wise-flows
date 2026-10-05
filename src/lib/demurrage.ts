// Demurrage calculation utility — no UI logic.
// Tiered rules per shipping line and container type, in USD/day.
// Final totals converted to JOD using a fixed rate.

export const USD_TO_JOD = 0.712;

export type DemurrageContainerType = "20FT" | "40FT";
export type DemurrageShippingLine = "SLG" | "SLD" | "WOM" | "SFT" | "EEL";

export interface DemurrageTier {
  // Inclusive start day, inclusive end day (null = open-ended).
  fromDay: number;
  toDay: number | null;
  rate20: number; // USD per day for 20FT
  rate40: number; // USD per day for 40FT
  label: string;
}

export interface DemurrageBreakdownRow {
  period: string;
  days: number;
  rateUSD: number;
  subtotalUSD: number;
}

export interface DemurrageResult {
  daysElapsed: number;
  freeDays: number;
  breakdown: DemurrageBreakdownRow[];
  totalUSD: number;
  totalJOD: number;
  error?: "missing-date" | "future-date";
}

// Tier definitions. Day numbering starts at 1 = port arrival day.
export const DEMURRAGE_RULES: Record<
  DemurrageShippingLine,
  { freeDays: number; tiers: DemurrageTier[] }
> = {
  SLG: {
    freeDays: 14,
    tiers: [
      { fromDay: 1, toDay: 14, rate20: 0, rate40: 0, label: "Days 1-14 (Free)" },
      { fromDay: 15, toDay: 21, rate20: 20, rate40: 40, label: "Days 15-21" },
      { fromDay: 22, toDay: null, rate20: 30, rate40: 60, label: "Day 22+" },
    ],
  },
  SFT: {
    freeDays: 14,
    tiers: [
      { fromDay: 1, toDay: 14, rate20: 0, rate40: 0, label: "Days 1-14 (Free)" },
      { fromDay: 15, toDay: 21, rate20: 20, rate40: 40, label: "Days 15-21" },
      { fromDay: 22, toDay: null, rate20: 30, rate40: 60, label: "Day 22+" },
    ],
  },
  SLD: {
    freeDays: 10,
    tiers: [
      { fromDay: 1, toDay: 10, rate20: 0, rate40: 0, label: "Days 1-10 (Free)" },
      { fromDay: 11, toDay: 15, rate20: 15, rate40: 25, label: "Days 11-15" },
      { fromDay: 16, toDay: 20, rate20: 30, rate40: 40, label: "Days 16-20" },
      { fromDay: 21, toDay: null, rate20: 45, rate40: 55, label: "Day 21+" },
    ],
  },
  WOM: {
    freeDays: 21,
    tiers: [
      { fromDay: 1, toDay: 21, rate20: 0, rate40: 0, label: "Days 1-21 (Free)" },
      { fromDay: 22, toDay: null, rate20: 50, rate40: 100, label: "Day 22+" },
    ],
  },
  // EEL charges far more than the other lines — 200-350 USD/day against their
  // 15-100. The figures are the line's published tariff, not a typo.
  EEL: {
    freeDays: 14,
    tiers: [
      { fromDay: 1, toDay: 14, rate20: 0, rate40: 0, label: "Days 1-14 (Free)" },
      { fromDay: 15, toDay: 17, rate20: 200, rate40: 250, label: "Days 15-17" },
      { fromDay: 18, toDay: null, rate20: 300, rate40: 350, label: "Day 18+" },
    ],
  },
};

// Maps a full container type code to the demurrage size bucket. Deliberately
// separate from `sizeBucketOf` in dashboardStats.ts: this picks a billing rate
// column, so a reefer bills at its length's rate and 45ft bills as 40ft, where
// the dashboard splits both out. Keep the money path independent of the table.
export const toDemurrageContainerType = (
  containerType: string,
): DemurrageContainerType => {
  const t = (containerType || "").toUpperCase();
  if (t.startsWith("20")) return "20FT";
  return "40FT";
};

export const hasDemurrageRules = (
  shippingLine: string,
): shippingLine is DemurrageShippingLine =>
  shippingLine === "SLG" || shippingLine === "SLD" || shippingLine === "WOM" ||
  shippingLine === "SFT" || shippingLine === "EEL";

const round2 = (n: number) => Math.round(n * 100) / 100;

const startOfLocalDay = (d: Date): Date =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate());

// ── Trip scoping ────────────────────────────────────────────────────────────
// A container can visit the yard multiple times. Each trip is anchored by the
// port arrival date currently on file — payments and gate-ins from before that
// date belong to a previous trip and must not settle or cap the current one.

/**
 * True when the most recent demurrage payment settles the current trip,
 * i.e. it was made on or after the trip's port arrival date. With no arrival
 * date to anchor a trip, any payment counts (legacy behavior).
 */
export const isDemurrageSettledForTrip = (
  lastPaymentAt: Date | null,
  portArrivalDate: string | null | undefined,
): boolean => {
  if (!lastPaymentAt) return false;
  if (!portArrivalDate) return true;
  const arrival = new Date(portArrivalDate);
  if (isNaN(arrival.getTime())) return true;
  return lastPaymentAt.getTime() >= startOfLocalDay(arrival).getTime();
};

/**
 * Earliest gate-in belonging to the current trip (on or after the port
 * arrival date) — demurrage stops accruing at that moment. Returns null when
 * the container hasn't been gated in this trip yet. With no arrival date,
 * falls back to the earliest gate-in ever (legacy behavior).
 */
export const firstGateInOfTrip = (
  gateInTimes: Date[],
  portArrivalDate: string | null | undefined,
): Date | null => {
  const sorted = [...gateInTimes].sort((a, b) => a.getTime() - b.getTime());
  if (!portArrivalDate) return sorted[0] ?? null;
  const arrival = new Date(portArrivalDate);
  if (isNaN(arrival.getTime())) return sorted[0] ?? null;
  const tripStart = startOfLocalDay(arrival).getTime();
  return sorted.find((t) => t.getTime() >= tripStart) ?? null;
};

// ── Free days per container ─────────────────────────────────────────────────
// A line's port list gives each container its own free days, which can differ
// from the line's standard free time. The list wins: the free period becomes
// that many days, and each paid period keeps its length and moves with the end
// of free time. So a WOM container granted 30 free days pays $50/day from day
// 31, and an SLG container granted 16 pays days 17-23 at the first rate.

/** The free days that apply: the port list's value when valid, else the line's standard. */
export const effectiveFreeDays = (
  shippingLine: DemurrageShippingLine,
  freeDays?: number | null,
): number => {
  if (freeDays == null || !Number.isFinite(freeDays) || freeDays < 0) {
    return DEMURRAGE_RULES[shippingLine].freeDays;
  }
  return Math.floor(freeDays);
};

const periodLabel = (from: number, to: number | null) =>
  to == null ? `Day ${from}+` : from === to ? `Day ${from}` : `Days ${from}-${to}`;

/** The line's tiers with the free period set to `freeDays` (standard tiers when omitted). */
export const tiersForFreeDays = (
  shippingLine: DemurrageShippingLine,
  freeDays?: number | null,
): DemurrageTier[] => {
  const rule = DEMURRAGE_RULES[shippingLine];
  const free = effectiveFreeDays(shippingLine, freeDays);
  if (free === rule.freeDays) return rule.tiers;

  const shift = free - rule.freeDays;
  const tiers: DemurrageTier[] = [];
  if (free > 0) {
    tiers.push({ fromDay: 1, toDay: free, rate20: 0, rate40: 0, label: `${periodLabel(1, free)} (Free)` });
  }
  for (const tier of rule.tiers) {
    if (tier.rate20 === 0 && tier.rate40 === 0) continue; // the standard free period
    const fromDay = tier.fromDay + shift;
    const toDay = tier.toDay == null ? null : tier.toDay + shift;
    tiers.push({ ...tier, fromDay, toDay, label: periodLabel(fromDay, toDay) });
  }
  return tiers;
};

/**
 * Last free day as YYYY-MM-DD: arrival day is day 1, so arrival + freeDays - 1.
 * Same as the lines' own sheets (Vessel Arrival Date + Free Days - 1). Null
 * when the arrival date doesn't parse.
 */
export const lastFreeDay = (
  portArrivalDate: string | null | undefined,
  freeDays: number,
): string | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(portArrivalDate ?? "");
  if (!m) return null;
  // Date.UTC keeps the arithmetic clear of local DST shifts.
  const day = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3] + freeDays - 1));
  return day.toISOString().slice(0, 10);
};

export interface FreeTimeStatus {
  /** Last free day (YYYY-MM-DD); null when there are no free days. */
  lastFreeDay: string | null;
  /** First charged day (YYYY-MM-DD), the day after the last free day. */
  firstChargedDay: string | null;
  /** Free days not yet used, counted to the same day as the result. */
  freeDaysLeft: number;
  /** Days past free time, i.e. the days being charged. */
  chargedDays: number;
}

/** Where a calculated result stands against its free time, in dates and days. */
export const freeTimeStatus = (
  result: DemurrageResult,
  portArrivalDate: string | null | undefined,
): FreeTimeStatus => ({
  lastFreeDay: result.freeDays > 0 ? lastFreeDay(portArrivalDate, result.freeDays) : null,
  // Free days + 1 counts one day past the last free one.
  firstChargedDay: lastFreeDay(portArrivalDate, result.freeDays + 1),
  freeDaysLeft: Math.max(0, result.freeDays - result.daysElapsed),
  chargedDays: Math.max(0, result.daysElapsed - result.freeDays),
});

export const calculateDemurrage = (
  shippingLine: string,
  containerType: string,
  portArrivalDate: string | null | undefined,
  today: Date = new Date(),
  // The container's free days from the line's port list. Omitted or invalid
  // falls back to the line's standard free days.
  freeDaysOverride?: number | null,
): DemurrageResult => {
  const empty: DemurrageResult = {
    daysElapsed: 0,
    freeDays: hasDemurrageRules(shippingLine)
      ? effectiveFreeDays(shippingLine, freeDaysOverride)
      : 0,
    breakdown: [],
    totalUSD: 0,
    totalJOD: 0,
  };

  if (!portArrivalDate) return { ...empty, error: "missing-date" };
  if (!hasDemurrageRules(shippingLine)) return empty;

  const arrival = new Date(portArrivalDate);
  if (isNaN(arrival.getTime())) return { ...empty, error: "missing-date" };

  const a = new Date(arrival.getFullYear(), arrival.getMonth(), arrival.getDate());
  const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffMs = t.getTime() - a.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return { ...empty, error: "future-date" };

  // Inclusive of arrival day → day count = diffDays + 1
  const daysElapsed = diffDays + 1;
  const size = toDemurrageContainerType(containerType);
  const freeDays = effectiveFreeDays(shippingLine, freeDaysOverride);
  const tiers = tiersForFreeDays(shippingLine, freeDays);

  const breakdown: DemurrageBreakdownRow[] = [];
  let totalUSD = 0;

  for (const tier of tiers) {
    const tierEnd = tier.toDay ?? daysElapsed;
    if (daysElapsed < tier.fromDay) break;
    const daysInPeriod = Math.min(daysElapsed, tierEnd) - tier.fromDay + 1;
    if (daysInPeriod <= 0) continue;
    const rate = size === "20FT" ? tier.rate20 : tier.rate40;
    if (rate === 0) continue; // skip free tiers in breakdown
    const subtotal = daysInPeriod * rate;
    totalUSD += subtotal;
    breakdown.push({
      period: tier.label,
      days: daysInPeriod,
      rateUSD: rate,
      subtotalUSD: subtotal,
    });
  }

  return {
    daysElapsed,
    freeDays,
    breakdown,
    totalUSD: round2(totalUSD),
    totalJOD: round2(totalUSD * USD_TO_JOD),
  };
};
