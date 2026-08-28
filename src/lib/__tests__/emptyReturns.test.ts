import { describe, expect, it } from "vitest";
import {
  deriveTerminalCheck,
  normalizeEmptyReturns,
  parseContainerNumbers,
  type EmptyReturnRecord,
} from "../emptyReturns";

describe("parseContainerNumbers", () => {
  it("splits a pasted list on commas, spaces and new lines", () => {
    expect(parseContainerNumbers("MRKU7137914, UACU8175070\nCXRU1082246 MRKU0562064"))
      .toEqual(["MRKU7137914", "UACU8175070", "CXRU1082246", "MRKU0562064"]);
  });

  it("upper-cases and drops the empties around stray separators", () => {
    expect(parseContainerNumbers("  mrku7137914 ,, ")).toEqual(["MRKU7137914"]);
    expect(parseContainerNumbers("   ")).toEqual([]);
  });
});

describe("normalizeEmptyReturns", () => {
  it("reads a record out of a wrapped response", () => {
    const payload = {
      emptyContainerReturns: [
        {
          containerId: "MRKU7137914",
          facilityCode: "SEGOT",
          shippingLine: "MAEU",
          containerIsoCode: "42G1",
          emptyReturnStatus: "ACCEPTED",
          accepted: true,
        },
      ],
    };
    expect(normalizeEmptyReturns(payload)).toEqual([
      {
        containerNumber: "MRKU7137914",
        facilityCode: "SEGOT",
        shippingLine: "MAEU",
        containerIsoCode: "42G1",
        terminalStatus: "ACCEPTED",
        accepted: true,
        returnedAt: null,
        message: null,
      },
    ]);
  });

  it("reads a bare array and lower-cased container numbers", () => {
    const records = normalizeEmptyReturns([
      { container_number: "uacu8175070", status: "OPEN" },
    ]);
    expect(records).toHaveLength(1);
    expect(records[0].containerNumber).toBe("UACU8175070");
    expect(records[0].terminalStatus).toBe("OPEN");
  });

  it("does not mistake a status word for a facility code", () => {
    const [record] = normalizeEmptyReturns([
      { assetId: "CXRU1082246", terminalStatus: "ACCEPTED" },
    ]);
    expect(record.facilityCode).toBeNull();
    expect(record.terminalStatus).toBe("ACCEPTED");
  });

  it("merges halves of one container split across nested objects", () => {
    const [record] = normalizeEmptyReturns({
      container: {
        containerId: "MRKU0562064",
        detail: { containerId: "MRKU0562064", facilityCode: "SEGOT", reason: "Full quota" },
      },
    });
    expect(record.facilityCode).toBe("SEGOT");
    expect(record.message).toBe("Full quota");
  });

  it("keeps one entry per container across several containers", () => {
    const records = normalizeEmptyReturns({
      containers: [
        { containerId: "MRKU7137914" },
        { containerId: "UACU8175070" },
        { containerId: "MRKU7137914" },
      ],
    });
    expect(records.map((r) => r.containerNumber)).toEqual([
      "MRKU7137914",
      "UACU8175070",
    ]);
  });

  it("returns nothing for an empty or unrelated payload", () => {
    expect(normalizeEmptyReturns({})).toEqual([]);
    expect(normalizeEmptyReturns(null)).toEqual([]);
    expect(normalizeEmptyReturns({ message: "No data found" })).toEqual([]);
  });
});

const record = (over: Partial<EmptyReturnRecord> = {}): EmptyReturnRecord => ({
  containerNumber: "MRKU7137914",
  facilityCode: "SEGOT",
  shippingLine: null,
  containerIsoCode: null,
  terminalStatus: null,
  accepted: null,
  returnedAt: null,
  message: null,
  ...over,
});

describe("deriveTerminalCheck", () => {
  it("reads an open return as 'not gated in at the terminal'", () => {
    const check = deriveTerminalCheck("mrku7137914", [record({ accepted: true })]);
    expect(check.status).toBe("not_returned");
    expect(check.detail).toContain("SEGOT");
  });

  it("treats a return date as the empty already being back", () => {
    const check = deriveTerminalCheck("MRKU7137914", [
      record({ accepted: true, returnedAt: "2026-08-21" }),
    ]);
    expect(check.status).toBe("returned");
    expect(check.detail).toContain("2026-08-21");
  });

  it("treats a returned/gated-in status word as the empty being back", () => {
    expect(deriveTerminalCheck("MRKU7137914", [record({ terminalStatus: "RETURNED" })]).status)
      .toBe("returned");
    expect(deriveTerminalCheck("MRKU7137914", [record({ terminalStatus: "Gated In" })]).status)
      .toBe("returned");
  });

  it("stays unknown when the container is not in the response", () => {
    const check = deriveTerminalCheck("MRKU7137914", []);
    expect(check.status).toBe("unknown");
    expect(check.record).toBeNull();
  });

  it("does not read a return restriction as a gate-in", () => {
    const check = deriveTerminalCheck("MRKU7137914", [
      record({ accepted: false, message: "Depot full" }),
    ]);
    expect(check.status).toBe("unknown");
    expect(check.detail).toContain("Depot full");
  });

  it("stays unknown when the record carries no return signal at all", () => {
    expect(deriveTerminalCheck("MRKU7137914", [record()]).status).toBe("unknown");
  });
});
