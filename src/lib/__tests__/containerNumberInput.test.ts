import { describe, expect, it } from "vitest";
import {
  applyDigitsEdit,
  applyLettersEdit,
  filterContainerNumberInput,
  splitContainerNumber,
} from "../containerNumberInput";
import { CONTAINER_NUMBER_REGEX } from "../validation";

describe("filterContainerNumberInput", () => {
  it("keeps 4 letters then 7 digits", () => {
    expect(filterContainerNumberInput("MSKU1234567")).toBe("MSKU1234567");
  });

  it("uppercases and drops separators", () => {
    expect(filterContainerNumberInput("msku 123456-7")).toBe("MSKU1234567");
  });

  it("refuses digits before the fourth letter", () => {
    expect(filterContainerNumberInput("MSK1")).toBe("MSK");
    expect(filterContainerNumberInput("1234")).toBe("");
  });

  it("refuses letters once the prefix is full", () => {
    expect(filterContainerNumberInput("MSKUV")).toBe("MSKU");
    expect(filterContainerNumberInput("MSKU12A34")).toBe("MSKU1234");
  });

  it("stops at 7 digits", () => {
    expect(filterContainerNumberInput("MSKU123456789")).toBe("MSKU1234567");
  });

  it("drops non-ASCII letters", () => {
    expect(filterContainerNumberInput("MÉSKU")).toBe("MSKU");
  });

  it("always yields a valid number once 11 characters are in", () => {
    const out = filterContainerNumberInput("ab-cd 12 34 56 7 extra 99");
    expect(out).toBe("ABCD1234567");
    expect(CONTAINER_NUMBER_REGEX.test(out)).toBe(true);
  });
});

describe("splitContainerNumber", () => {
  it("splits a complete number", () => {
    expect(splitContainerNumber("MSKU1234567")).toEqual({ prefix: "MSKU", serial: "1234567" });
  });

  it("keeps the digits with a prefix being corrected", () => {
    expect(splitContainerNumber("MKU1234567")).toEqual({ prefix: "MKU", serial: "1234567" });
  });

  it("handles partial and empty values", () => {
    expect(splitContainerNumber("MS")).toEqual({ prefix: "MS", serial: "" });
    expect(splitContainerNumber("")).toEqual({ prefix: "", serial: "" });
  });
});

describe("applyLettersEdit", () => {
  it("adds typed letters and ignores typed digits while the prefix is short", () => {
    expect(applyLettersEdit("MSK", "")).toEqual({ value: "MSK", overflow: 0 });
    expect(applyLettersEdit("MSK1", "")).toEqual({ value: "MSK", overflow: 0 });
  });

  it("keeps the digits when a letter is deleted or replaced", () => {
    expect(applyLettersEdit("MKU", "1234567")).toEqual({ value: "MKU1234567", overflow: 0 });
    expect(applyLettersEdit("MSKV", "1234567")).toEqual({ value: "MSKV1234567", overflow: 0 });
  });

  it("splits a whole number pasted into the letters box", () => {
    expect(applyLettersEdit("MSKU1234567", "")).toEqual({ value: "MSKU1234567", overflow: 7 });
    expect(applyLettersEdit("TGHU7654321", "1234567")).toEqual({ value: "TGHU7654321", overflow: 7 });
  });

  it("sends a digit typed after a full prefix to the front of the digits", () => {
    expect(applyLettersEdit("MSKU1", "234567")).toEqual({ value: "MSKU1234567", overflow: 1 });
  });
});

describe("applyDigitsEdit", () => {
  it("keeps digits only, up to 7", () => {
    expect(applyDigitsEdit("123", "MSKU")).toBe("MSKU123");
    expect(applyDigitsEdit("12a3-4", "MSKU")).toBe("MSKU1234");
    expect(applyDigitsEdit("123456789", "MSKU")).toBe("MSKU1234567");
  });

  it("takes a whole number pasted into the digits box", () => {
    expect(applyDigitsEdit("TGHU7654321", "MSKU")).toBe("TGHU7654321");
  });

  it("clears to the prefix when the digits are deleted", () => {
    expect(applyDigitsEdit("", "MSKU")).toBe("MSKU");
  });
});
