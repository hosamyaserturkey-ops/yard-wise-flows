import { describe, expect, it } from "vitest";
import { normalizeVin, validateVin } from "../vin";

describe("normalizeVin", () => {
  it("removes spaces and upper-cases", () => {
    expect(normalizeVin(" jtd kb20u0 93000001 ")).toBe("JTDKB20U093000001");
  });
});

describe("validateVin", () => {
  it("accepts a real-looking VIN, in any case and with spaces", () => {
    expect(validateVin("JTDKB20U093000001")).toBeNull();
    expect(validateVin("jtdkb20u093000001")).toBeNull();
    expect(validateVin("JTDKB 20U0 93000001")).toBeNull();
  });

  it("asks for a VIN when empty", () => {
    expect(validateVin("  ")).toMatch(/enter/i);
  });

  it("says how long the VIN is when the length is wrong", () => {
    expect(validateVin("JTDKB20U09300000")).toMatch(/17.*16/);
    expect(validateVin("JTDKB20U0930000012")).toMatch(/17.*18/);
  });

  it("rejects I, O and Q with a hint", () => {
    for (const letter of ["I", "O", "Q"]) {
      expect(validateVin(`JTDKB20U09300000${letter}`)).toMatch(/I, O or Q/);
    }
  });

  it("rejects symbols", () => {
    expect(validateVin("JTDKB20U09300000-")).toMatch(/letters and digits/i);
  });
});
