import { describe, expect, it } from "vitest";
import { distinctSorted, normalizeBlock, normalizeRow } from "../yardSlots";

describe("normalizeBlock", () => {
  it("trims, upper-cases and collapses spaces", () => {
    expect(normalizeBlock(" osc ")).toBe("OSC");
    expect(normalizeBlock("block  a")).toBe("BLOCK A");
  });
  it("keeps non-Latin text", () => {
    expect(normalizeBlock(" بدون ")).toBe("بدون");
  });
});

describe("normalizeRow", () => {
  it("pads plain numbers to two digits", () => {
    expect(normalizeRow("1")).toBe("01");
    expect(normalizeRow("01")).toBe("01");
    expect(normalizeRow("003")).toBe("03");
    expect(normalizeRow("12")).toBe("12");
    expect(normalizeRow("120")).toBe("120");
  });
  it("leaves text rows alone apart from case and spaces", () => {
    expect(normalizeRow(" a3 ")).toBe("A3");
  });
});

describe("distinctSorted", () => {
  it("merges spellings of the same slot and sorts naturally", () => {
    expect(distinctSorted(["1", "01", "10", "2", null, " "], normalizeRow)).toEqual(["01", "02", "10"]);
  });
});
