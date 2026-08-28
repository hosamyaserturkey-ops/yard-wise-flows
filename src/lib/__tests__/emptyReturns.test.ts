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
        openFrom: null,
        openUntil: null,
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

  it("merges halves of one container split across sibling records", () => {
    const [record] = normalizeEmptyReturns({
      containers: [
        { containerId: "MRKU0562064" },
        { containerId: "MRKU0562064", facilityCode: "SEGOT", reason: "Full quota" },
      ],
    });
    expect(record.facilityCode).toBe("SEGOT");
    expect(record.message).toBe("Full quota");
  });

  it("reads return detail nested under the container, not just beside it", () => {
    // The shape that made a live JOAQJ lookup read as "no answer": the
    // container carries only its identity, and the acceptance sits in a
    // nested list of return locations.
    const [record] = normalizeEmptyReturns({
      containers: [
        {
          containerId: "CAIU4652539",
          shippingLine: "SLG",
          containerIsoCode: "4561",
          emptyReturnLocations: [
            { facilityCode: "JOAQJ", status: "ACCEPTED", validFrom: "2026-08-20", validTo: "2026-09-05" },
          ],
        },
      ],
    });
    expect(record.facilityCode).toBe("JOAQJ");
    expect(record.terminalStatus).toBe("ACCEPTED");
    expect(record.openFrom).toBe("2026-08-20");
    expect(record.openUntil).toBe("2026-09-05");
    expect(record.shippingLine).toBe("SLG");
  });

  it("reads the facility that was asked about when several are listed", () => {
    const payload = {
      containers: [
        {
          containerId: "CAIU4652539",
          returnLocations: [
            { facilityCode: "SEGOT", status: "NOT ACCEPTED" },
            { facilityCode: "JOAQJ", status: "ACCEPTED" },
          ],
        },
      ],
    };
    expect(normalizeEmptyReturns(payload, "JOAQJ")[0].terminalStatus).toBe("ACCEPTED");
    expect(normalizeEmptyReturns(payload, "SEGOT")[0].terminalStatus).toBe("NOT ACCEPTED");
    // With no preference stated, the first listed location answers.
    expect(normalizeEmptyReturns(payload)[0].facilityCode).toBe("SEGOT");
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
  openFrom: null,
  openUntil: null,
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

  it("reads an open return window as the empty still being out", () => {
    const check = deriveTerminalCheck("CAIU4652539", [
      record({ containerNumber: "CAIU4652539", facilityCode: "JOAQJ", openFrom: "2026-08-20", openUntil: "2026-09-05" }),
    ]);
    expect(check.status).toBe("not_returned");
    expect(check.detail).toContain("2026-08-20 to 2026-09-05");
  });

  it("prefers a reported return date over an open window", () => {
    const check = deriveTerminalCheck("MRKU7137914", [
      record({ openFrom: "2026-08-20", returnedAt: "2026-08-25" }),
    ]);
    expect(check.status).toBe("returned");
  });

  it("stays unknown when the record carries no return signal at all", () => {
    expect(deriveTerminalCheck("MRKU7137914", [record()]).status).toBe("unknown");
  });
});
