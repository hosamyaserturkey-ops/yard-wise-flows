import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import {
  buildLotMap, carTagText, defaultSpot, deviceLabel, freePlaces, placesByZone, readScan, slotCode, slotErrorMessage, slotNameProblem,
  slotPart, slotQrText, slotsInRange, spotKey, tileState, type LotSlot, type MapCar,
} from "../lotSlots";
import { readQrPixels } from "../qr";

describe("slot names (same rules as the database)", () => {
  it("normalises each part", () => {
    expect(slotPart(" a ", false)).toBe("A");
    expect(slotPart("7", true)).toBe("07");
    expect(slotPart("007", true)).toBe("07");
    expect(slotPart("112", true)).toBe("112");
    expect(slotPart("0", true)).toBe("00");
    expect(slotPart("", true)).toBeNull();
  });

  it("builds the printed code, keeping every digit of long numbers", () => {
    expect(slotCode(" a ", "1", "1")).toBe("A-01-01");
    expect(slotCode("b", null, "12")).toBe("B-12");
    expect(slotCode("receiving")).toBe("RECEIVING");
    expect(slotCode("a", "1", "112")).toBe("A-01-112");
    expect(slotCode("a", null, "0007")).toBe("A-07");
  });

  // The same vectors as docs/car-lot/tests/slots.sql (private.lot_spot_key).
  it.each([
    ["b 3 7", "B-03-07"], ["B3-7", "B-03-07"], ["b-03-07", "B-03-07"], ["Z10", "Z-10"], ["receiving", "RECEIVING"],
    ["007", "07"], ["0", "00"], ["A/12.3", "A-12-03"], ["a 112", "A-112"], ["A-0100", "A-100"],
  ])("reads a typed spot %j as %j", (typed, key) => {
    expect(spotKey(typed)).toBe(key);
  });

  it("finds nothing in an empty spot", () => {
    expect(spotKey("  ")).toBeNull();
    expect(spotKey(null)).toBeNull();
  });

  it("matches a typed spot to the printed code it means", () => {
    expect(spotKey("b 3 7")).toBe(spotKey(slotCode("B", "3", "7")));
    expect(spotKey("A01-1")).toBe(spotKey(slotCode("A", "1", "1"))); // why look-alike codes are refused
  });

  it("says what is wrong with a name", () => {
    expect(slotNameProblem("")).toMatch(/zone/);
    expect(slotNameProblem("A B")).toMatch(/letters and digits/);
    expect(slotNameProblem("A", "1", "1-2")).toMatch(/Slot may only/);
    expect(slotNameProblem("A", "1", "12")).toBeNull();
  });
});

describe("slotsInRange", () => {
  it("makes every slot, row by row", () => {
    expect(slotsInRange({ zone: "B", rowFrom: 1, rowTo: 2, slotFrom: 1, slotTo: 3 })).toEqual([
      { zone: "B", row_label: "1", slot: "1" }, { zone: "B", row_label: "1", slot: "2" }, { zone: "B", row_label: "1", slot: "3" },
      { zone: "B", row_label: "2", slot: "1" }, { zone: "B", row_label: "2", slot: "2" }, { zone: "B", row_label: "2", slot: "3" },
    ]);
  });

  it("makes slots without rows", () => {
    expect(slotsInRange({ zone: "C", slotFrom: 9, slotTo: 10 })).toEqual([
      { zone: "C", row_label: null, slot: "9" }, { zone: "C", row_label: null, slot: "10" },
    ]);
  });

  it("refuses backwards, broken or oversized ranges", () => {
    expect(slotsInRange({ zone: "C", slotFrom: 5, slotTo: 1 })).toMatch(/lower to a higher/);
    expect(slotsInRange({ zone: "C", rowFrom: 1, rowTo: null, slotFrom: 1, slotTo: 2 })).toMatch(/Row numbers/);
    expect(slotsInRange({ zone: "C", rowFrom: 1, rowTo: 30, slotFrom: 1, slotTo: 20 })).toMatch(/at most 500/);
    expect(slotsInRange({ zone: "", slotFrom: 1, slotTo: 2 })).toMatch(/zone/);
  });
});

describe("readScan", () => {
  const id = "3f2b6c1e-8d4a-4b7e-9c21-0a5d6e7f8a9b";

  it("knows a slot label", () => {
    expect(readScan(slotQrText(id))).toEqual({ kind: "slot", slotId: id });
    expect(readScan(`  evl-loc:${id.toUpperCase()} `)).toEqual({ kind: "slot", slotId: id });
  });

  it("knows a car tag and a car's own VIN barcode", () => {
    expect(readScan(carTagText("jtdkb20u093000001"))).toEqual({ kind: "car", vin: "JTDKB20U093000001" });
    expect(readScan("JTDKB20U093000001")).toEqual({ kind: "car", vin: "JTDKB20U093000001" });
    expect(readScan("IJTDKB20U093000001")).toEqual({ kind: "car", vin: "JTDKB20U093000001" }); // leading I on US VIN barcodes
  });

  it("does not guess at anything else", () => {
    expect(readScan("EVL-LOC:not-an-id").kind).toBe("unknown");
    expect(readScan("JTDKB20U09300000O").kind).toBe("unknown"); // the letter O never appears in a VIN
    expect(readScan("hello").kind).toBe("unknown");
  });
});

describe("QR round trip", () => {
  /** Draws a QR code the way a printed label would look, as RGBA pixels. */
  function pixels(text: string, scale = 4, quiet = 4) {
    const { modules } = QRCode.create(text, { errorCorrectionLevel: "M" });
    const size = (modules.size + quiet * 2) * scale;
    const data = new Uint8ClampedArray(size * size * 4).fill(255);
    for (let r = 0; r < modules.size; r++) {
      for (let c = 0; c < modules.size; c++) {
        if (!modules.get(r, c)) continue;
        for (let y = 0; y < scale; y++) {
          for (let x = 0; x < scale; x++) {
            const i = (((r + quiet) * scale + y) * size + (c + quiet) * scale + x) * 4;
            data[i] = data[i + 1] = data[i + 2] = 0;
          }
        }
      }
    }
    return { data, size };
  }

  it.each([slotQrText("3f2b6c1e-8d4a-4b7e-9c21-0a5d6e7f8a9b"), carTagText("JTDKB20U093000001")])(
    "a printed %s reads back exactly", async (text) => {
      const { data, size } = pixels(text);
      expect(await readQrPixels(data, size, size)).toBe(text);
    });
});

describe("the lot map", () => {
  const slot = (code: string, zone: string, row: string | null, s: string | null, over: Partial<LotSlot> = {}): LotSlot => ({
    id: code, code, zone, row_label: row, slot: s, kind: "storage", capacity: 1, active: true, ...over,
  });
  const car = (vin: string, locationId: string | null, days = 1, over: Partial<MapCar> = {}): MapCar => ({
    visitId: vin, vin, manufacturerCode: "TOY", locationId, zone: null, slot: null, status: "in-lot", days, ...over,
  });

  it("groups slots by zone and row in natural order, with the cars in them", () => {
    const slots = [slot("B-01", "B", null, "01"), slot("A-01-10", "A", "01", "10"), slot("A-01-02", "A", "01", "02"),
      slot("A-02-01", "A", "02", "01", { capacity: 2 })];
    const { zones, unplaced } = buildLotMap(slots, [car("V1", "A-01-02"), car("V2", "A-02-01"), car("V3", null, 9), car("V4", "gone", 3)]);
    expect(zones.map((z) => z.zone)).toEqual(["A", "B"]);
    expect(zones[0].rows.map((r) => [r.row, r.tiles.map((t) => t.slot.code)])).toEqual([
      ["01", ["A-01-02", "A-01-10"]], ["02", ["A-02-01"]],
    ]);
    expect(zones[0]).toMatchObject({ used: 2, capacity: 4 });
    expect(zones[0].rows[0].tiles[0]).toMatchObject({ state: "full" });
    expect(zones[0].rows[1].tiles[0]).toMatchObject({ state: "partly" });
    expect(unplaced.map((c) => c.vin)).toEqual(["V3", "V4"]); // a slot not on the list counts as no slot; longest stay first
  });

  it("leaves empty slots out of use off the map, but not ones still holding a car", () => {
    const slots = [slot("A-1", "A", null, "1", { active: false }), slot("A-2", "A", null, "2", { active: false })];
    const { zones } = buildLotMap(slots, [car("V1", "A-2")]);
    expect(zones[0].rows[0].tiles.map((t) => t.slot.code)).toEqual(["A-2"]);
  });

  it("names each state", () => {
    expect([tileState(0, 1), tileState(1, 2), tileState(2, 2), tileState(3, 2)]).toEqual(["empty", "partly", "full", "over"]);
    expect(freePlaces({ capacity: 2 }, 3)).toBe(0);
  });

  it("adds up the places of each zone's slots in use", () => {
    const places = placesByZone([slot("A-1", "A", null, "1", { capacity: 2 }), slot("A-2", "A", null, "2"),
      slot("A-3", "A", null, "3", { active: false }), slot("B-1", "B", null, "1", { capacity: 5 })]);
    expect([...places]).toEqual([["A", 3], ["B", 5]]);
  });

  it("suggests the first receiving slot with room at registration", () => {
    const slots = [slot("R-2", "R", null, "2", { kind: "receiving" }), slot("R-10", "R", null, "10", { kind: "receiving" }),
      slot("R-1", "R", null, "1", { kind: "receiving", active: false }), slot("A-1", "A", null, "1")];
    expect(defaultSpot(slots, new Map())).toEqual({ kind: "slot", slotId: "R-2" });
    expect(defaultSpot(slots, new Map([["R-2", 1]]))).toEqual({ kind: "slot", slotId: "R-10" }); // 2 is full; 10 sorts after 2
    expect(defaultSpot(slots, new Map([["R-2", 1], ["R-10", 1]]))).toEqual({ kind: "none" }); // pick one yourself
    expect(defaultSpot([slot("A-1", "A", null, "1", { active: false })], new Map())).toEqual({ kind: "typed", zone: "", slot: "" });
    expect(defaultSpot([], new Map())).toEqual({ kind: "typed", zone: "", slot: "" }); // no slots: type it, as before
  });
});

describe("slotErrorMessage", () => {
  it("turns the database's answers into plain language", () => {
    expect(slotErrorMessage({ message: "slot A-01-01 is full: it holds JTDKB20U093000001" }))
      .toBe("Slot A-01-01 is full. It holds JTDKB20U093000001.");
    expect(slotErrorMessage({ message: "a released car cannot be moved" })).toBe("This car has already left the lot.");
    expect(slotErrorMessage({ message: "only the car lot's admin or the owner can put a car in a full slot" }))
      .toBe("Only the car lot's admin can put a car in a full slot.");
    expect(slotErrorMessage({ message: "TypeError: Failed to fetch" })).toBe("No signal: nothing was saved. Try again.");
    expect(slotErrorMessage({ code: "42501", message: "not allowed to move cars" })).toBe("You are not allowed to do this.");
    expect(slotErrorMessage({ message: "duplicate key value violates unique constraint" })).toMatch(/already exists/);
  });
});

describe("deviceLabel", () => {
  it("is made once and kept on the device", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const first = deviceLabel(storage);
    expect(first).toMatch(/^device-[0-9a-f]{4}$/);
    expect(deviceLabel(storage)).toBe(first);
  });

  it("still works when the device refuses storage", () => {
    const broken = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
    expect(deviceLabel(broken)).toMatch(/^device-/);
    expect(deviceLabel(null)).toMatch(/^device-/);
  });
});
