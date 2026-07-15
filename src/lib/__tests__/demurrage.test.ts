import { describe, expect, it } from "vitest";
import {
  calculateDemurrage,
  hasDemurrageRules,
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

  it("reports the configured free days", () => {
    for (const line of ["SLG", "SLD", "WOM"] as const) {
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
