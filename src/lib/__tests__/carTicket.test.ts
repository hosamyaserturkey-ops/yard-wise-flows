import { describe, expect, it } from "vitest";
import { buildCarTicketHtml, type CarTicketData } from "../carTicket";
import { RECEIPT_PRINT_SCRIPT } from "../gateInReceipt";

const base: CarTicketData = {
  kind: "gate_in", ticketNumber: 41, yardName: "Everest Logistics - Car Lot", manufacturerName: "Toyota", manufacturerCode: "TOY",
  vin: "JTDKB20U093000001", model: "Corolla", modelYear: 2026, color: "White",
  gateInTime: "2026-11-04T08:00:00Z", gateOutTime: null, lotZone: "A", lotSlot: "12",
  driverName: "Omar Saleh", truckNumber: "12-3456", gateOutDriverName: null, gateOutTruckNumber: null,
  odometerIn: 12, odometerOut: null, keyCount: 2, daysStored: 1, operatorName: "Lina Haddad", condition: null,
};
const profile = { yard_name: "Car Lot", full_name: "Sam Reprinter", username: "sam" };
const build = (over: Partial<CarTicketData> = {}, ctx?: { isReprint?: boolean }) =>
  buildCarTicketHtml({ ...base, ...over }, profile, ctx, new Date("2026-11-10T09:05:00"));

describe("car ticket: reception", () => {
  it("shows the ticket number padded, the VIN, manufacturer and the Arabic title", () => {
    const html = build();
    expect(html).toContain("VEHICLE RECEPTION TICKET");
    expect(html).toContain("وصل استلام مركبة");
    expect(html).toContain("# 000041");
    expect(html).toContain("JTDKB20U093000001");
    expect(html).toContain("Toyota");
    expect(html).toContain("Corolla · 2026 · White");
    expect(html).toContain("A / 12");
    expect(html).toContain("Omar Saleh");
    expect(html).toContain("Received By");
    expect(html).toContain("Lina Haddad");
  });

  it("has no release section and no money or liability text", () => {
    const html = build();
    expect(html).not.toContain("DAYS STORED");
    expect(html).not.toMatch(/JOD|demurrage|liab|insur/i);
  });

  it("shows a dash for anything missing", () => {
    const html = build({ ticketNumber: null, driverName: null, model: null, modelYear: null, color: null, lotZone: null, lotSlot: null });
    expect(html).toContain("# —");
    expect(html).toContain('<div class="field-value">—</div>');
  });
});

describe("car ticket: release", () => {
  const out = { kind: "gate_out" as const, gateOutTime: "2026-11-10T10:30:00Z", gateOutDriverName: "Khaled N.", gateOutTruckNumber: "99-1111", odometerOut: 40, daysStored: 7 };

  it("is titled as a release and shows the stay and the release driver", () => {
    const html = build(out);
    expect(html).toContain("VEHICLE RELEASE TICKET");
    expect(html).toContain("وصل تسليم مركبة");
    expect(html).toContain("Released By");
    expect(html).toContain("DAYS STORED");
    expect(html).toContain("Khaled N.");
    expect(html).toContain("99-1111");
    expect(html).toContain("12 km / 40 km");
    expect(html).not.toContain("Omar Saleh"); // the arrival driver is not the one leaving
  });
});

describe("car ticket: condition at arrival", () => {
  const condition = { odometer: 12, fuelLevel: "half", keysPresent: true, notes: "Dusty", damageNotes: ["Dent, rear left door", "Scratch, bumper"] };

  it("lists the recorded condition and each damage line", () => {
    const html = build({ condition });
    expect(html).toContain("Condition at arrival");
    expect(html).toContain("½");
    expect(html).toContain("Dent, rear left door");
    expect(html).toContain("Scratch, bumper");
    expect(html).toContain("Dusty");
  });

  it("says None when no damage was noted, and is left out when there is no inspection", () => {
    expect(build({ condition: { ...condition, damageNotes: [] } })).toContain(">None<");
    expect(build({ condition: null })).not.toContain("Condition at arrival");
  });

  it("caps a long damage list and says how many more are in the record", () => {
    const many = Array.from({ length: 11 }, (_, i) => `Damage ${i + 1}`);
    const html = build({ condition: { ...condition, damageNotes: many } });
    expect(html).toContain("Damage 8");
    expect(html).not.toContain("Damage 9<");
    expect(html).toContain("+ 3 more in the inspection record");
  });

  it("is not on a release ticket", () => {
    expect(build({ kind: "gate_out", condition })).not.toContain("Condition at arrival");
  });
});

describe("car ticket: attribution and reprints", () => {
  it("names the stored operator on a reprint, never the person reprinting", () => {
    const html = build({}, { isReprint: true });
    expect(html).toContain("Reprinted:");
    expect(html).toContain("Lina Haddad");
    expect(html).toMatch(/by sam/); // the footer names who produced the paper
    expect(html).not.toMatch(/sig-value">Sam/);
  });

  it("prints a dash, not the reprinting user, when the operator is unknown on a reprint", () => {
    expect(build({ operatorName: null }, { isReprint: true })).toMatch(/sig-value">—</);
  });

  it("names the signed-in user on a live print when no operator is stored", () => {
    expect(build({ operatorName: null })).toMatch(/sig-value">Sam Reprinter</);
  });
});

describe("car ticket: safety", () => {
  it("escapes everything a person can type", () => {
    const evil = '<img src=x onerror="alert(1)">';
    const html = build({
      vin: evil, driverName: evil, truckNumber: evil, model: evil, manufacturerName: evil, operatorName: evil,
      condition: { odometer: null, fuelLevel: null, keysPresent: null, notes: evil, damageNotes: [evil] },
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("carries exactly one inline script: the shared print script the CSP allows by hash", () => {
    const scripts = [...build().matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
    expect(scripts).toEqual([RECEIPT_PRINT_SCRIPT]);
  });
});
