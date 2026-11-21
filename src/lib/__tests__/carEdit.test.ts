import { describe, expect, it } from "vitest";
import { carEditChanges, formFromCar, hasChanges, validateCarEdit, type CarEditSource } from "../carEdit";

const car: CarEditSource = {
  vin: "JTDKB20U093000001", model: "Corolla", model_year: 2026, color: "White", lot_zone: "A", lot_slot: "12",
  odometer_in: 12, key_count: 2, driver_name: "Omar Saleh", truck_number: "12-3456", free_days: 7,
};
const form = () => formFromCar(car);

describe("formFromCar", () => {
  it("starts from the car's values, empty text for missing ones", () => {
    expect(form()).toMatchObject({ vin: "JTDKB20U093000001", model_year: "2026", free_days: "7", odometer_in: "12" });
    expect(formFromCar({ ...car, model: null, model_year: null, odometer_in: null }))
      .toMatchObject({ model: "", model_year: "", odometer_in: "" });
  });
});

describe("validateCarEdit", () => {
  it("accepts the untouched form", () => {
    expect(validateCarEdit(form())).toBeNull();
  });

  it("rejects a VIN that cannot be right, with the reason", () => {
    expect(validateCarEdit({ ...form(), vin: "JTDKB20U09300000" })).toMatch(/17/);
    expect(validateCarEdit({ ...form(), vin: "JTDKB20U09300000I" })).toMatch(/I, O or Q/);
  });

  it("accepts a VIN typed in lower case or with spaces", () => {
    expect(validateCarEdit({ ...form(), vin: "jtd kb20u093000001" })).toBeNull();
  });

  it("checks the year, odometer, keys and free days", () => {
    expect(validateCarEdit({ ...form(), model_year: "1950" })).toMatch(/year/i);
    expect(validateCarEdit({ ...form(), model_year: "abc" })).toMatch(/year/i);
    expect(validateCarEdit({ ...form(), model_year: "" })).toBeNull();
    expect(validateCarEdit({ ...form(), odometer_in: "12.5" })).toMatch(/odometer/i);
    expect(validateCarEdit({ ...form(), odometer_in: "" })).toBeNull();
    expect(validateCarEdit({ ...form(), key_count: "100" })).toMatch(/keys/i);
    expect(validateCarEdit({ ...form(), free_days: "" })).toMatch(/free days/i);
    expect(validateCarEdit({ ...form(), free_days: "366" })).toMatch(/free days/i);
    expect(validateCarEdit({ ...form(), free_days: "0" })).toBeNull();
  });
});

describe("carEditChanges", () => {
  it("is empty when nothing was touched", () => {
    const c = carEditChanges(form(), form());
    expect(c).toEqual({ vehicle: {}, visit: {} });
    expect(hasChanges(c)).toBe(false);
  });

  it("sends only the fields that changed, split into the car and the visit", () => {
    const c = carEditChanges(form(), { ...form(), color: "Black", lot_slot: "13", free_days: "10" });
    expect(c).toEqual({ vehicle: { color: "Black" }, visit: { lot_slot: "13", free_days: 10 } });
    expect(hasChanges(c)).toBe(true);
  });

  it("normalises a corrected VIN, and ignores a change that is only case or spaces", () => {
    expect(carEditChanges(form(), { ...form(), vin: "jtdkb20u093000009" }).vehicle).toEqual({ vin: "JTDKB20U093000009" });
    expect(carEditChanges(form(), { ...form(), vin: " jtdkb20u093000001 " })).toEqual({ vehicle: {}, visit: {} });
  });

  it("turns a cleared box into null (not an empty string or zero)", () => {
    const c = carEditChanges(form(), { ...form(), model: "  ", model_year: "", odometer_in: "", key_count: "", driver_name: "" });
    expect(c.vehicle).toEqual({ model: null, model_year: null });
    expect(c.visit).toEqual({ odometer_in: null, key_count: null, driver_name: null });
  });

  it("trims text and reads numbers", () => {
    const c = carEditChanges(form(), { ...form(), model: "  Camry ", odometer_in: "40", key_count: "0" });
    expect(c.vehicle).toEqual({ model: "Camry" });
    expect(c.visit).toEqual({ odometer_in: 40, key_count: 0 });
  });

  it("never includes the manufacturer or the yard, which cannot be edited", () => {
    const c = carEditChanges(form(), { ...form(), model: "X" });
    expect(Object.keys({ ...c.vehicle, ...c.visit }).some((k) => /manufacturer|yard/.test(k))).toBe(false);
  });
});
