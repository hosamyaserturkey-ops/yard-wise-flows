// Demurrage calculation utility — no UI logic.
// Tiered rules per shipping line and container type, in USD/day.
// Final totals converted to JOD using a fixed rate.

export const USD_TO_JOD = 0.712;

export type DemurrageContainerType = "20FT" | "40FT";
export type DemurrageShippingLine = "SLG" | "SLD" | "WOM";

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
};

// Maps a full container type code to the demurrage size bucket.
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
  shippingLine === "SLG" || shippingLine === "SLD" || shippingLine === "WOM";

const round2 = (n: number) => Math.round(n * 100) / 100;

export const calculateDemurrage = (
  shippingLine: string,
  containerType: string,
  portArrivalDate: string | null | undefined,
  today: Date = new Date(),
): DemurrageResult => {
  const empty: DemurrageResult = {
    daysElapsed: 0,
    freeDays: hasDemurrageRules(shippingLine)
      ? DEMURRAGE_RULES[shippingLine].freeDays
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
  const { freeDays, tiers } = DEMURRAGE_RULES[shippingLine];

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
