import { describe, expect, it } from "vitest";
import { previousShiftSlot, shiftSlotFor } from "../shifts";

describe("shiftSlotFor", () => {
  it("names a day shift by its date", () => {
    expect(shiftSlotFor(new Date(2026, 8, 28, 6, 0))).toEqual({ shiftDate: "2026-09-28", shift: "day" });
    expect(shiftSlotFor(new Date(2026, 8, 28, 17, 59))).toEqual({ shiftDate: "2026-09-28", shift: "day" });
  });

  it("keeps a night shift on the date it started, past midnight", () => {
    expect(shiftSlotFor(new Date(2026, 8, 28, 18, 0))).toEqual({ shiftDate: "2026-09-28", shift: "night" });
    expect(shiftSlotFor(new Date(2026, 8, 29, 5, 59))).toEqual({ shiftDate: "2026-09-28", shift: "night" });
    expect(shiftSlotFor(new Date(2026, 9, 1, 2, 0))).toEqual({ shiftDate: "2026-09-30", shift: "night" });
  });
});

describe("previousShiftSlot", () => {
  it("steps night → same day's day, and day → previous night", () => {
    expect(previousShiftSlot({ shiftDate: "2026-09-28", shift: "night" })).toEqual({ shiftDate: "2026-09-28", shift: "day" });
    expect(previousShiftSlot({ shiftDate: "2026-10-01", shift: "day" })).toEqual({ shiftDate: "2026-09-30", shift: "night" });
  });
});
