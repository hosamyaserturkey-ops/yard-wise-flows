import { describe, expect, it } from "vitest";
import { allowedActions, carActionErrorMessage, daysInLot, daysOverFree, gateInErrorMessage, gateOutBlockedReason } from "../carLot";

describe("daysInLot", () => {
  const now = new Date("2026-11-10T12:00:00Z");

  it("counts the arrival day as day 1", () => {
    expect(daysInLot("2026-11-10T08:00:00Z", now)).toBe(1);
  });

  it("counts whole days since arrival", () => {
    expect(daysInLot("2026-11-03T12:00:00Z", now)).toBe(8);
    expect(daysInLot("2026-11-03T13:00:00Z", now)).toBe(7);
  });

  it("stops counting at gate-out", () => {
    expect(daysInLot("2026-11-01T00:00:00Z", now, "2026-11-04T00:00:00Z")).toBe(4);
  });

  it("never goes below 1 for odd input", () => {
    expect(daysInLot("not a date", now)).toBe(1);
    expect(daysInLot("2026-11-11T00:00:00Z", now)).toBe(1);
  });
});

describe("daysOverFree", () => {
  it("is zero inside the free days and counts the rest after", () => {
    expect(daysOverFree(5, 7)).toBe(0);
    expect(daysOverFree(7, 7)).toBe(0);
    expect(daysOverFree(10, 7)).toBe(3);
  });
});

describe("allowedActions", () => {
  it("lets a car in the lot be held or gated out, not released", () => {
    expect(allowedActions("in-lot")).toEqual({ hold: true, release: false, gateOut: true });
  });

  it("only lets a held car be released; it cannot be gated out", () => {
    expect(allowedActions("on-hold")).toEqual({ hold: false, release: true, gateOut: false });
  });

  it("allows nothing on a released visit", () => {
    expect(allowedActions("out")).toEqual({ hold: false, release: false, gateOut: false });
  });
});

describe("gateInErrorMessage", () => {
  it("explains a car that is already in the lot", () => {
    expect(gateInErrorMessage({ code: "23505", message: 'duplicate key value violates unique constraint "vehicle_visits_one_open_per_vehicle"' }))
      .toBe("This car is already in the lot.");
  });

  it("explains a duplicate VIN", () => {
    expect(gateInErrorMessage({ code: "23505", message: 'duplicate key ... "vehicles_vin_key"' }))
      .toMatch(/already registered/);
  });

  it("explains a row-level-security refusal", () => {
    expect(gateInErrorMessage({ code: "42501", message: 'new row violates row-level security policy for table "vehicles"' }))
      .toMatch(/not allowed/);
  });

  it("passes any other message through", () => {
    expect(gateInErrorMessage({ message: "something else" })).toBe("something else");
  });
});

describe("gate-out needs a closed departure inspection", () => {
  it("is blocked while the departure inspection is not closed", () => {
    expect(allowedActions("in-lot", false).gateOut).toBe(false);
    expect(allowedActions("in-lot", true).gateOut).toBe(true);
    expect(allowedActions("on-hold", true).gateOut).toBe(false);
  });
  it("says why the button is disabled", () => {
    expect(gateOutBlockedReason("in-lot", false)).toMatch(/departure inspection/);
    expect(gateOutBlockedReason("on-hold", true)).toMatch(/Release the hold/);
    expect(gateOutBlockedReason("in-lot", true)).toBeUndefined();
  });
});

describe("carActionErrorMessage", () => {
  it("turns the database rules into plain messages", () => {
    expect(carActionErrorMessage({ message: "close the departure inspection before gate-out" })).toMatch(/Close the departure inspection/);
    expect(carActionErrorMessage({ message: "a reason is required to put a car on hold" })).toMatch(/why the car is put on hold/);
    expect(carActionErrorMessage({ message: "a reason is required to change a VIN" })).toMatch(/why the VIN/);
    expect(carActionErrorMessage({ message: "a released car cannot be edited" })).toMatch(/already left/);
    expect(carActionErrorMessage({ code: "42501", message: "only the car lot's admin or the owner can edit a car" })).toMatch(/Only the car lot's admin/);
    expect(carActionErrorMessage({ code: "23505", message: "duplicate key" })).toMatch(/already registered/);
    expect(carActionErrorMessage({ message: "other" })).toBe("other");
  });
});
