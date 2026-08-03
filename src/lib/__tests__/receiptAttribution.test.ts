import { describe, it, expect } from "vitest";
import { operatorSignatureName } from "@/lib/gateInReceipt";

const printer = { full_name: "Reprinting Clerk", username: "clerk" };

describe("operatorSignatureName", () => {
  it("names the signed-in user when printing live at the gate", () => {
    expect(operatorSignatureName(printer, undefined)).toBe("Reprinting Clerk");
  });

  it("falls back to the username when the gate operator has no full name", () => {
    expect(operatorSignatureName({ username: "op7" }, undefined)).toBe("op7");
  });

  it("names the stored gate operator on a reprint, not the person reprinting", () => {
    expect(
      operatorSignatureName(printer, { operatorName: "Original Operator", isReprint: true }),
    ).toBe("Original Operator");
  });

  it("never credits the person reprinting when the gate operator is unknown", () => {
    expect(operatorSignatureName(printer, { operatorName: null, isReprint: true })).toBe("—");
    expect(operatorSignatureName(printer, { operatorName: "   ", isReprint: true })).toBe("—");
  });

  it("prefers a stored operator even outside a reprint", () => {
    expect(operatorSignatureName(printer, { operatorName: "Gate Operator" })).toBe("Gate Operator");
  });
});
