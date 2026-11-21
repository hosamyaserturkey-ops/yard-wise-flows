import { describe, expect, it } from "vitest";
import { eventChangeLines, eventLabel } from "../carHistory";

describe("car history", () => {
  it("names each kind of event", () => {
    expect(eventLabel("hold")).toBe("Put on hold");
    expect(eventLabel("gate_out")).toMatch(/gate-out/);
    expect(eventLabel("something_new")).toBe("something_new");
  });
  it("shows old → new for edits, in a stable order, without status or the hold reason", () => {
    expect(eventChangeLines({ action: "edit", changes: { lot_slot: ["3", "9"], vin: ["A", "B"], status: ["in-lot", "in-lot"] } }))
      .toEqual(["VIN: A → B", "Slot: 3 → 9"]);
    expect(eventChangeLines({ action: "hold", changes: { status: ["in-lot", "on-hold"], hold_reason: [null, "x"] } })).toEqual([]);
  });
  it("shows empty values as a dash, and only the new value for what a gate-out fills in", () => {
    expect(eventChangeLines({ action: "edit", changes: { color: ["White", null] } })).toEqual(["Colour: White → —"]);
    expect(eventChangeLines({ action: "gate_out", changes: { gate_out_driver_name: [null, "Khaled"] } })).toEqual(["Driver out: Khaled"]);
    expect(eventChangeLines({ action: "edit", changes: null })).toEqual([]);
  });
});

describe("moves", () => {
  it("are labelled, say how the place was chosen, and hide the slot's id", async () => {
    const { eventLabel, eventHow, eventChangeLines } = await import("../carHistory");
    expect(eventLabel("move")).toBe("Moved");
    expect(eventHow({ via: "scan", device: "device-7f3a" })).toBe("scanned, on device-7f3a");
    expect(eventHow({ via: "typed", device: null })).toBe("typed");
    expect(eventHow({ via: null, device: null })).toBe("");
    expect(eventChangeLines({ action: "move", changes: { lot_zone: [null, "A"], lot_slot: [null, "01-01"], location_id: [null, "x"] } }))
      .toEqual(["Zone: — → A", "Slot: — → 01-01"]);
  });
});
