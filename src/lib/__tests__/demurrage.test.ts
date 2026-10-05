import { describe, expect, it } from "vitest";
import {
  calculateDemurrage,
  effectiveFreeDays,
  firstGateInOfTrip,
  freeTimeStatus,
  lastFreeDay,
  tiersForFreeDays,
  hasDemurrageRules,
  isDemurrageSettledForTrip,
  toDemurrageContainerType,
  DEMURRAGE_RULES,
  USD_TO_JOD,
} from "../demurrage";

const d = (iso: string) => new Date(`${iso}T12:00:00`);

describe("toDemurrageContainerType", () => {
  it("maps 20-foot codes to 20FT", () => {
    expect(toDemurrageContainerType("20FT")).toBe("20FT");
    expect(toDemurrageContainerType("20FR")).toBe("20FT");
    expect(toDemurrageContainerType("20fr")).toBe("20FT");
  });

  it("maps everything else to 40FT", () => {
    expect(toDemurrageContainerType("40FT")).toBe("40FT");
    expect(toDemurrageContainerType("40HC")).toBe("40FT");
    expect(toDemurrageContainerType("45FT")).toBe("40FT");
    expect(toDemurrageContainerType("")).toBe("40FT");
  });
});

describe("hasDemurrageRules", () => {
  it("recognises the configured lines", () => {
    expect(hasDemurrageRules("SLG")).toBe(true);
    expect(hasDemurrageRules("SLD")).toBe(true);
    expect(hasDemurrageRules("WOM")).toBe(true);
    expect(hasDemurrageRules("SFT")).toBe(true);
    expect(hasDemurrageRules("EEL")).toBe(true);
  });

  it("rejects unknown lines", () => {
    expect(hasDemurrageRules("MSC")).toBe(false);
    expect(hasDemurrageRules("")).toBe(false);
  });
});

describe("calculateDemurrage — error handling", () => {
  it("flags a missing arrival date", () => {
    const r = calculateDemurrage("SLG", "20FT", null);
    expect(r.error).toBe("missing-date");
    expect(r.totalJOD).toBe(0);
  });

  it("flags an unparseable arrival date", () => {
    const r = calculateDemurrage("SLG", "20FT", "not-a-date");
    expect(r.error).toBe("missing-date");
  });

  it("flags a future arrival date", () => {
    const r = calculateDemurrage("SLG", "20FT", "2026-02-01", d("2026-01-01"));
    expect(r.error).toBe("future-date");
    expect(r.totalJOD).toBe(0);
  });

  it("returns zero without error for lines with no rules", () => {
    const r = calculateDemurrage("MSC", "20FT", "2026-01-01", d("2026-03-01"));
    expect(r.error).toBeUndefined();
    expect(r.totalUSD).toBe(0);
    expect(r.breakdown).toHaveLength(0);
  });
});

describe("calculateDemurrage — day counting", () => {
  it("counts the arrival day as day 1", () => {
    const r = calculateDemurrage("SLG", "20FT", "2026-01-01", d("2026-01-01"));
    expect(r.daysElapsed).toBe(1);
    expect(r.totalUSD).toBe(0);
  });

  it("is free through the last free day", () => {
    // SLG free period: days 1-14
    const r = calculateDemurrage("SLG", "20FT", "2026-01-01", d("2026-01-14"));
    expect(r.daysElapsed).toBe(14);
    expect(r.totalUSD).toBe(0);
    expect(r.breakdown).toHaveLength(0);
  });

  it("starts charging on the first day after the free period", () => {
    // Day 15 for SLG → one chargeable day at $20 (20FT)
    const r = calculateDemurrage("SLG", "20FT", "2026-01-01", d("2026-01-15"));
    expect(r.daysElapsed).toBe(15);
    expect(r.totalUSD).toBe(20);
    expect(r.breakdown).toHaveLength(1);
    expect(r.breakdown[0].days).toBe(1);
  });
});

describe("calculateDemurrage — tiered totals", () => {
  it("charges across SLG tiers for a 20FT container", () => {
    // Arrival 2026-01-01, as-of 2026-01-25 → 25 days elapsed.
    // Days 15-21: 7 × $20 = $140; days 22-25: 4 × $30 = $120 → $260.
    const r = calculateDemurrage("SLG", "20FT", "2026-01-01", d("2026-01-25"));
    expect(r.daysElapsed).toBe(25);
    expect(r.totalUSD).toBe(260);
    expect(r.totalJOD).toBe(Math.round(260 * USD_TO_JOD * 100) / 100);
    expect(r.breakdown.map((b) => b.subtotalUSD)).toEqual([140, 120]);
  });

  it("uses the 40FT column for large containers", () => {
    // Same window as above but 40FT: 7 × $40 + 4 × $60 = $520.
    const r = calculateDemurrage("SLG", "40HC", "2026-01-01", d("2026-01-25"));
    expect(r.totalUSD).toBe(520);
  });

  it("walks all SLD tiers", () => {
    // Arrival 2026-01-01, as-of 2026-01-18 → 18 days.
    // Days 11-15: 5 × $15 = $75; days 16-18: 3 × $30 = $90 → $165.
    const r = calculateDemurrage("SLD", "20FT", "2026-01-01", d("2026-01-18"));
    expect(r.daysElapsed).toBe(18);
    expect(r.totalUSD).toBe(165);
  });

  it("reaches the open-ended SLD tier", () => {
    // 30 days: 5 × $15 + 5 × $30 + 10 × $45 = $675.
    const r = calculateDemurrage("SLD", "20FT", "2026-01-01", d("2026-01-30"));
    expect(r.daysElapsed).toBe(30);
    expect(r.totalUSD).toBe(675);
  });

  it("honours WOM's 21 free days then flat rate", () => {
    const free = calculateDemurrage("WOM", "40FT", "2026-01-01", d("2026-01-21"));
    expect(free.totalUSD).toBe(0);

    // Day 23 → 2 chargeable days × $100 (40FT).
    const charged = calculateDemurrage("WOM", "40FT", "2026-01-01", d("2026-01-23"));
    expect(charged.totalUSD).toBe(200);
  });

  it("charges SFT tiers identically to SLG", () => {
    // Same window as the SLG tiered-totals test above: 25 days elapsed →
    // days 15-21: 7 × $20 = $140; days 22-25: 4 × $30 = $120 → $260 (20FT).
    const r = calculateDemurrage("SFT", "20FT", "2026-01-01", d("2026-01-25"));
    expect(r.daysElapsed).toBe(25);
    expect(r.totalUSD).toBe(260);
    expect(r.breakdown.map((b) => b.subtotalUSD)).toEqual([140, 120]);
    expect(DEMURRAGE_RULES.SFT).toEqual(DEMURRAGE_RULES.SLG);
  });

  it("reports the configured free days", () => {
    for (const line of ["SLG", "SLD", "WOM", "SFT", "EEL"] as const) {
      const r = calculateDemurrage(line, "20FT", "2026-01-01", d("2026-01-02"));
      expect(r.freeDays).toBe(DEMURRAGE_RULES[line].freeDays);
    }
  });

  it("rounds JOD conversion to 2 decimals", () => {
    // SLD day 11 → 1 × $15 = $15 → 15 × 0.712 = 10.68 JOD.
    const r = calculateDemurrage("SLD", "20FT", "2026-01-01", d("2026-01-11"));
    expect(r.totalJOD).toBe(10.68);
  });
});

// EEL's published tariff, checked against the line's own worked example:
// arrival 03/08/2026, 14 free days, last free day 16/08, demurrage from 17/08.
// First period 17/08-19/08, second period 20/08 onwards.
describe("calculateDemurrage — EEL", () => {
  const ARRIVAL = "2026-08-03";

  it("stays free through the 14th day (16/08)", () => {
    const r = calculateDemurrage("EEL", "40HC", ARRIVAL, d("2026-08-16"));
    expect(r.daysElapsed).toBe(14);
    expect(r.freeDays).toBe(14);
    expect(r.totalUSD).toBe(0);
    expect(r.breakdown).toEqual([]);
  });

  it("starts charging on 17/08, the 15th day", () => {
    const hc = calculateDemurrage("EEL", "40HC", ARRIVAL, d("2026-08-17"));
    expect(hc.daysElapsed).toBe(15);
    expect(hc.totalUSD).toBe(250);

    const sd = calculateDemurrage("EEL", "20GP", ARRIVAL, d("2026-08-17"));
    expect(sd.totalUSD).toBe(200);
  });

  it("charges the full first period at the lower rate (17/08-19/08)", () => {
    // 3 days: 40' HC 3 × $250 = $750; 20' SD 3 × $200 = $600.
    const hc = calculateDemurrage("EEL", "40HC", ARRIVAL, d("2026-08-19"));
    expect(hc.daysElapsed).toBe(17);
    expect(hc.totalUSD).toBe(750);
    expect(hc.breakdown).toHaveLength(1);

    const sd = calculateDemurrage("EEL", "20GP", ARRIVAL, d("2026-08-19"));
    expect(sd.totalUSD).toBe(600);
  });

  it("steps up to the second period on 20/08", () => {
    // Day 18 → first period 3 × $250 = $750, plus 1 × $350 → $1100 (40' HC).
    const r = calculateDemurrage("EEL", "40HC", ARRIVAL, d("2026-08-20"));
    expect(r.daysElapsed).toBe(18);
    expect(r.totalUSD).toBe(1100);
    expect(r.breakdown.map((b) => b.rateUSD)).toEqual([250, 350]);
  });

  it("spans both periods", () => {
    // As-of 25/08 → 3 × $250 + 6 × $350 = $2850 (40' HC).
    const hc = calculateDemurrage("EEL", "40HC", ARRIVAL, d("2026-08-25"));
    expect(hc.daysElapsed).toBe(23);
    expect(hc.totalUSD).toBe(2850);
    expect(hc.breakdown.map((b) => b.subtotalUSD)).toEqual([750, 2100]);
    expect(hc.totalJOD).toBe(Math.round(2850 * USD_TO_JOD * 100) / 100);

    // 20' SD over the same window: 3 × $200 + 6 × $300 = $2400.
    const sd = calculateDemurrage("EEL", "20GP", ARRIVAL, d("2026-08-25"));
    expect(sd.totalUSD).toBe(2400);
    expect(sd.breakdown.map((b) => b.subtotalUSD)).toEqual([600, 1800]);
  });

  it("buckets every container type by size", () => {
    const asOf = d("2026-08-19"); // 3 chargeable days in the first period
    for (const type of ["20GP", "20RF", "20FR", "20OT", "20TK"]) {
      expect(calculateDemurrage("EEL", type, ARRIVAL, asOf).totalUSD).toBe(600);
    }
    for (const type of ["40GP", "40HC", "40RF", "40RH", "45HC"]) {
      expect(calculateDemurrage("EEL", type, ARRIVAL, asOf).totalUSD).toBe(750);
    }
  });
});

describe("isDemurrageSettledForTrip", () => {
  it("is unsettled with no payment on record", () => {
    expect(isDemurrageSettledForTrip(null, "2026-01-01")).toBe(false);
  });

  it("does NOT let a previous trip's payment settle a new trip", () => {
    // Paid in January, container returns with a July port arrival.
    const paidLastTrip = d("2026-01-10");
    expect(isDemurrageSettledForTrip(paidLastTrip, "2026-07-01")).toBe(false);
  });

  it("counts a payment made during the current trip", () => {
    const paidThisTrip = d("2026-07-05");
    expect(isDemurrageSettledForTrip(paidThisTrip, "2026-07-01")).toBe(true);
  });

  it("counts a payment made on the arrival day itself", () => {
    const paidOnArrival = new Date(2026, 6, 1, 0, 30); // 1 Jul, 00:30 local
    expect(isDemurrageSettledForTrip(paidOnArrival, "2026-07-01")).toBe(true);
  });

  it("falls back to any-payment-counts when no arrival date anchors a trip", () => {
    expect(isDemurrageSettledForTrip(d("2026-01-10"), null)).toBe(true);
    expect(isDemurrageSettledForTrip(d("2026-01-10"), "not-a-date")).toBe(true);
  });
});

describe("firstGateInOfTrip", () => {
  const trip1GateIn = d("2026-01-12");
  const trip2GateIn = d("2026-07-08");

  it("returns null when the container was never gated in", () => {
    expect(firstGateInOfTrip([], "2026-07-01")).toBeNull();
  });

  it("ignores gate-ins from previous trips", () => {
    // Only a January gate-in exists; the new trip started in July, so
    // demurrage for the new trip is NOT capped by the old visit.
    expect(firstGateInOfTrip([trip1GateIn], "2026-07-01")).toBeNull();
  });

  it("picks the first gate-in on or after the trip's arrival date", () => {
    expect(firstGateInOfTrip([trip1GateIn, trip2GateIn], "2026-07-01")).toEqual(trip2GateIn);
  });

  it("sorts before picking", () => {
    expect(firstGateInOfTrip([trip2GateIn, trip1GateIn], "2026-01-01")).toEqual(trip1GateIn);
  });

  it("falls back to the earliest gate-in ever without an arrival date", () => {
    expect(firstGateInOfTrip([trip2GateIn, trip1GateIn], null)).toEqual(trip1GateIn);
  });
});

// WOM's port list (EVL_DEMURAGE_SUNNY_.xlsx): 20ft, 21 free days, $50/day,
// Last Free Day = Vessel Arrival Date + Free Days - 1.
describe("calculateDemurrage — WOM port list", () => {
  it("matches the sheet for the 12 Sep vessel", () => {
    expect(lastFreeDay("2026-09-12", 21)).toBe("2026-10-02");
    expect(calculateDemurrage("WOM", "20GP", "2026-09-12", d("2026-10-02"), 21).totalUSD).toBe(0);
    const first = calculateDemurrage("WOM", "20GP", "2026-09-12", d("2026-10-03"), 21);
    expect(first.totalUSD).toBe(50);
    expect(first.totalJOD).toBe(35.6);
  });

  it("matches the sheet for the 20 Sep vessel", () => {
    expect(lastFreeDay("2026-09-20", 21)).toBe("2026-10-10");
    // Sheet: (today - last free day) x 50. 15 Oct → 5 days → $250.
    expect(calculateDemurrage("WOM", "20GP", "2026-09-20", d("2026-10-15"), 21).totalUSD).toBe(250);
  });
});

describe("free days from the port list", () => {
  it("falls back to the line's standard when the list gives none", () => {
    expect(effectiveFreeDays("WOM", undefined)).toBe(21);
    expect(effectiveFreeDays("WOM", null)).toBe(21);
    expect(effectiveFreeDays("WOM", Number.NaN)).toBe(21);
    expect(effectiveFreeDays("WOM", -3)).toBe(21);
    expect(effectiveFreeDays("WOM", 30)).toBe(30);
    expect(effectiveFreeDays("WOM", 0)).toBe(0);
  });

  it("returns the standard tiers unchanged when the list agrees", () => {
    expect(tiersForFreeDays("SLD", 10)).toBe(DEMURRAGE_RULES.SLD.tiers);
    expect(tiersForFreeDays("SLD", undefined)).toBe(DEMURRAGE_RULES.SLD.tiers);
  });

  it("extends WOM's free period and charges from the day after", () => {
    const free = calculateDemurrage("WOM", "20GP", "2026-01-01", d("2026-01-30"), 30);
    expect(free.freeDays).toBe(30);
    expect(free.totalUSD).toBe(0);
    // Day 32 → 2 chargeable days × $50.
    const charged = calculateDemurrage("WOM", "20GP", "2026-01-01", d("2026-02-01"), 30);
    expect(charged.totalUSD).toBe(100);
    expect(charged.breakdown[0].period).toBe("Day 31+");
  });

  it("shortens the free period when the list grants fewer days", () => {
    // 14 free days → day 15 is the first paid day.
    const r = calculateDemurrage("WOM", "40HC", "2026-01-01", d("2026-01-16"), 14);
    expect(r.freeDays).toBe(14);
    expect(r.totalUSD).toBe(200); // days 15-16 × $100
  });

  it("charges from day 1 with zero free days", () => {
    const r = calculateDemurrage("WOM", "20GP", "2026-01-01", d("2026-01-03"), 0);
    expect(r.totalUSD).toBe(150);
    expect(tiersForFreeDays("WOM", 0)[0].label).toBe("Day 1+");
  });

  it("moves each paid tier back by the extra free days, keeping its length", () => {
    // SLD standard: free 1-10, 11-15 $15, 16-20 $30, 21+ $45.
    // 13 free days: free 1-13, 14-18 $15, 19-23 $30, 24+ $45.
    const tiers = tiersForFreeDays("SLD", 13);
    expect(tiers.map((t) => [t.fromDay, t.toDay, t.label])).toEqual([
      [1, 13, "Days 1-13 (Free)"],
      [14, 18, "Days 14-18"],
      [19, 23, "Days 19-23"],
      [24, null, "Day 24+"],
    ]);
    // Day 20: 5 × $15 + 2 × $30 = $135 (20ft).
    expect(calculateDemurrage("SLD", "20GP", "2026-01-01", d("2026-01-20"), 13).totalUSD).toBe(135);
  });

  it("ignores free days for lines that aren't charged", () => {
    const r = calculateDemurrage("7Seas", "20GP", "2026-01-01", d("2026-03-01"), 5);
    expect(r.totalUSD).toBe(0);
    expect(r.freeDays).toBe(0);
  });
});

describe("lastFreeDay", () => {
  it("counts the arrival day as day 1", () => {
    expect(lastFreeDay("2026-01-01", 1)).toBe("2026-01-01");
    expect(lastFreeDay("2026-01-01", 14)).toBe("2026-01-14");
  });

  it("crosses month and year ends", () => {
    expect(lastFreeDay("2026-12-20", 21)).toBe("2027-01-09");
    expect(lastFreeDay("2028-02-20", 10)).toBe("2028-02-29");
  });

  it("returns null for a missing or malformed date", () => {
    expect(lastFreeDay(null, 21)).toBeNull();
    expect(lastFreeDay("20/09/2026", 21)).toBeNull();
  });
});

describe("freeTimeStatus", () => {
  // The Gate In screenshot case: WOM, arrived 20 Sep 2026, 21 free days.
  const arrival = "2026-09-20";

  it("gives the last free day and the days left inside free time", () => {
    const r = calculateDemurrage("WOM", "20GP", arrival, d("2026-10-05"), 21);
    expect(freeTimeStatus(r, arrival)).toEqual({
      lastFreeDay: "2026-10-10",
      firstChargedDay: "2026-10-11",
      freeDaysLeft: 5,
      chargedDays: 0,
    });
  });

  it("has no free days left on the last free day itself", () => {
    const r = calculateDemurrage("WOM", "20GP", arrival, d("2026-10-10"), 21);
    expect(r.totalUSD).toBe(0);
    expect(freeTimeStatus(r, arrival)).toMatchObject({ freeDaysLeft: 0, chargedDays: 0 });
  });

  it("counts the charged days once free time has ended", () => {
    const r = calculateDemurrage("WOM", "20GP", arrival, d("2026-10-15"), 21);
    const s = freeTimeStatus(r, arrival);
    expect(s).toMatchObject({ lastFreeDay: "2026-10-10", firstChargedDay: "2026-10-11", freeDaysLeft: 0, chargedDays: 5 });
    // Same days the bill charges for.
    expect(s.chargedDays).toBe(r.breakdown.reduce((n, row) => n + row.days, 0));
  });

  it("uses the port list's free days, not the line's standard", () => {
    const r = calculateDemurrage("WOM", "20GP", arrival, d("2026-10-05"), 30);
    expect(freeTimeStatus(r, arrival)).toMatchObject({ lastFreeDay: "2026-10-19", freeDaysLeft: 14 });
  });

  it("has no last free day when free time is zero", () => {
    const r = calculateDemurrage("WOM", "20GP", arrival, d("2026-09-22"), 0);
    expect(freeTimeStatus(r, arrival)).toMatchObject({
      lastFreeDay: null,
      firstChargedDay: "2026-09-20",
      chargedDays: 3,
    });
  });
});
