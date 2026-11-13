import { describe, expect, it } from "vitest";
import { normalizeManufacturerCode, validateManufacturer } from "../manufacturers";

const ok = { code: "toy", name: "Toyota", contact_email: "", default_free_days: "7" };

describe("validateManufacturer", () => {
  it("accepts a complete form and an empty contact email", () => {
    expect(validateManufacturer(ok)).toBeNull();
    expect(validateManufacturer({ ...ok, contact_email: "ops@toyota.example" })).toBeNull();
  });

  it("needs a code and a name", () => {
    expect(validateManufacturer({ ...ok, code: " " })).toMatch(/required/i);
    expect(validateManufacturer({ ...ok, name: "" })).toMatch(/required/i);
  });

  it("rejects a code with symbols or the wrong length", () => {
    expect(validateManufacturer({ ...ok, code: "T-Y" })).toMatch(/code/i);
    expect(validateManufacturer({ ...ok, code: "T" })).toMatch(/code/i);
    expect(validateManufacturer({ ...ok, code: "ABCDEFGHIJK" })).toMatch(/code/i);
  });

  it("rejects a bad email", () => {
    expect(validateManufacturer({ ...ok, contact_email: "not-an-email" })).toMatch(/email/i);
  });

  it("rejects free days that are not a whole number from 0 to 365", () => {
    for (const bad of ["", "-1", "1.5", "366", "abc"]) {
      expect(validateManufacturer({ ...ok, default_free_days: bad })).toMatch(/free days/i);
    }
    expect(validateManufacturer({ ...ok, default_free_days: "0" })).toBeNull();
  });
});

describe("normalizeManufacturerCode", () => {
  it("trims and upper-cases", () => {
    expect(normalizeManufacturerCode("  hyu ")).toBe("HYU");
  });
});
