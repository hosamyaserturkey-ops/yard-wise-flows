import { describe, expect, it } from "vitest";
import {
  bookingSchema,
  driverNameSchema,
  gateInSchema,
  gateOutSchema,
  truckNumberSchema,
  truckNumberWarning,
} from "../validation";

const validGateIn = {
  containerNumber: "SLDX1234567",
  containerType: "40HC",
  shippingLine: "SLD",
  driverName: "Ali Hassan",
  truckNumber: "TRK001",
  portArrivalDate: "2026-01-01",
  freeDays: "10",
  dailyDemurrage: "15",
};

describe("gateInSchema", () => {
  it("accepts a complete gate-in payload", () => {
    expect(gateInSchema.safeParse(validGateIn).success).toBe(true);
  });

  it("rejects lowercase or symbol container numbers", () => {
    expect(gateInSchema.safeParse({ ...validGateIn, containerNumber: "sldx1234567" }).success).toBe(false);
    expect(gateInSchema.safeParse({ ...validGateIn, containerNumber: "SLDX-123456" }).success).toBe(false);
    expect(gateInSchema.safeParse({ ...validGateIn, containerNumber: "" }).success).toBe(false);
  });

  it("requires exactly 4 letters followed by 7 numbers", () => {
    expect(gateInSchema.safeParse({ ...validGateIn, containerNumber: "MSKU1234567" }).success).toBe(true);
    expect(gateInSchema.safeParse({ ...validGateIn, containerNumber: "MSK1234567" }).success).toBe(false); // 3 letters
    expect(gateInSchema.safeParse({ ...validGateIn, containerNumber: "MSKUA234567" }).success).toBe(false); // letter in digit run
    expect(gateInSchema.safeParse({ ...validGateIn, containerNumber: "MSKU123456" }).success).toBe(false); // 6 digits
    expect(gateInSchema.safeParse({ ...validGateIn, containerNumber: "MSKU12345678" }).success).toBe(false); // 8 digits
  });

  it("rejects unknown container types", () => {
    expect(gateInSchema.safeParse({ ...validGateIn, containerType: "50FT" }).success).toBe(false);
  });

  it("accepts the full set of ISO container types", () => {
    for (const code of ["20GP", "40GP", "45HC", "20RF", "40RF", "40RH", "20FR", "40FR", "20OT", "40OT", "20TK", "40TK"]) {
      expect(gateInSchema.safeParse({ ...validGateIn, containerType: code }).success).toBe(true);
    }
  });

  it("still accepts legacy container-type codes on existing records", () => {
    for (const code of ["20FT", "40FT", "45FT"]) {
      expect(gateInSchema.safeParse({ ...validGateIn, containerType: code }).success).toBe(true);
    }
  });

  it("treats port arrival date as optional (no-demurrage lines gate in without it)", () => {
    const base = { ...validGateIn };
    delete (base as Record<string, unknown>).portArrivalDate;
    expect(gateInSchema.safeParse(base).success).toBe(true);
    expect(gateInSchema.safeParse({ ...validGateIn, portArrivalDate: "" }).success).toBe(true);
  });

  it("treats free days and daily demurrage as optional (formula-driven, not user-entered)", () => {
    const base = { ...validGateIn };
    delete (base as Record<string, unknown>).freeDays;
    delete (base as Record<string, unknown>).dailyDemurrage;
    expect(gateInSchema.safeParse(base).success).toBe(true);
  });
});

describe("gateOutSchema", () => {
  const validGateOut = {
    bookingNumber: "BK-4417",
    sealNumber: "SL123456",
    driverName: "Ali",
    truckNumber: "TRK1",
    fees: "120.50",
  };

  it("accepts a valid gate-out payload", () => {
    expect(gateOutSchema.safeParse(validGateOut).success).toBe(true);
  });

  it("bounds fees to 0-999,999.99", () => {
    expect(gateOutSchema.safeParse({ ...validGateOut, fees: "0" }).success).toBe(true);
    expect(gateOutSchema.safeParse({ ...validGateOut, fees: "999999.99" }).success).toBe(true);
    expect(gateOutSchema.safeParse({ ...validGateOut, fees: "1000000" }).success).toBe(false);
    expect(gateOutSchema.safeParse({ ...validGateOut, fees: "-1" }).success).toBe(false);
    expect(gateOutSchema.safeParse({ ...validGateOut, fees: "" }).success).toBe(false);
  });

  it("requires a booking number to attach", () => {
    expect(gateOutSchema.safeParse({ ...validGateOut, bookingNumber: "" }).success).toBe(false);
    expect(gateOutSchema.safeParse({ ...validGateOut, bookingNumber: "   " }).success).toBe(false);
    expect(gateOutSchema.safeParse({ ...validGateOut, bookingNumber: "B".repeat(51) }).success).toBe(false);
  });

  it("requires a seal number of uppercase letters, numbers and hyphens", () => {
    expect(gateOutSchema.safeParse({ ...validGateOut, sealNumber: "" }).success).toBe(false);
    expect(gateOutSchema.safeParse({ ...validGateOut, sealNumber: "  " }).success).toBe(false);
    expect(gateOutSchema.safeParse({ ...validGateOut, sealNumber: "ABC-123" }).success).toBe(true);
    expect(gateOutSchema.safeParse({ ...validGateOut, sealNumber: "1234567" }).success).toBe(true);
    expect(gateOutSchema.safeParse({ ...validGateOut, sealNumber: "sl123456" }).success).toBe(false);
    expect(gateOutSchema.safeParse({ ...validGateOut, sealNumber: "SL 123 456" }).success).toBe(false);
    expect(gateOutSchema.safeParse({ ...validGateOut, sealNumber: "-SL123" }).success).toBe(false);
    expect(gateOutSchema.safeParse({ ...validGateOut, sealNumber: "S".repeat(21) }).success).toBe(false);
  });

  it("trims the booking and seal it hands back", () => {
    const parsed = gateOutSchema.safeParse({ ...validGateOut, sealNumber: " SL123456 ", bookingNumber: " BK-4417 " });
    expect(parsed.success && parsed.data.sealNumber).toBe("SL123456");
    expect(parsed.success && parsed.data.bookingNumber).toBe("BK-4417");
  });

  it("requires driver name and truck number", () => {
    expect(gateOutSchema.safeParse({ ...validGateOut, driverName: "  " }).success).toBe(false);
    expect(gateOutSchema.safeParse({ ...validGateOut, truckNumber: "" }).success).toBe(false);
  });
});

describe("bookingSchema", () => {
  const validBooking = {
    booking_number: "BK-2026_001",
    customer_name: "Acme Shipping",
    shipping_line: "WOM",
    total_containers: 12,
  };

  it("accepts a valid booking", () => {
    expect(bookingSchema.safeParse(validBooking).success).toBe(true);
  });

  it("requires a shipping line — it scopes which containers may use the booking", () => {
    expect(bookingSchema.safeParse({ ...validBooking, shipping_line: "" }).success).toBe(false);
    expect(bookingSchema.safeParse({ ...validBooking, shipping_line: "   " }).success).toBe(false);
    const { shipping_line: _omitted, ...withoutLine } = validBooking;
    expect(bookingSchema.safeParse(withoutLine).success).toBe(false);
  });

  it("accepts the separators lines actually issue — slashes and dots", () => {
    expect(bookingSchema.safeParse({ ...validBooking, booking_number: "EEL0030/26" }).success).toBe(true);
    expect(bookingSchema.safeParse({ ...validBooking, booking_number: "SGN/2026/0012" }).success).toBe(true);
    expect(bookingSchema.safeParse({ ...validBooking, booking_number: "BK.2026.001" }).success).toBe(true);
  });

  it("rejects booking numbers with spaces or symbols", () => {
    expect(bookingSchema.safeParse({ ...validBooking, booking_number: "BK 001" }).success).toBe(false);
    expect(bookingSchema.safeParse({ ...validBooking, booking_number: "BK#001" }).success).toBe(false);
  });

  it("trims the booking number and customer name it hands back", () => {
    const parsed = bookingSchema.safeParse({
      ...validBooking,
      booking_number: " EEL0030/26 ",
      customer_name: " PIONEER CARGO Company ",
    });
    expect(parsed.success && parsed.data.booking_number).toBe("EEL0030/26");
    expect(parsed.success && parsed.data.customer_name).toBe("PIONEER CARGO Company");
  });

  it("requires at least one whole container", () => {
    expect(bookingSchema.safeParse({ ...validBooking, total_containers: 0 }).success).toBe(false);
    expect(bookingSchema.safeParse({ ...validBooking, total_containers: 2.5 }).success).toBe(false);
    expect(bookingSchema.safeParse({ ...validBooking, total_containers: 10001 }).success).toBe(false);
  });
});

describe("driverNameSchema", () => {
  const parse = (v: string) => driverNameSchema.safeParse(v);
  const error = (v: string) => { const r = parse(v); return r.success ? null : r.error.issues[0].message; };

  it("stores one spelling: trimmed, single-spaced, Latin letters in capitals", () => {
    const r = parse("  mohammad   al-hassan ");
    expect(r.success && r.data).toBe("MOHAMMAD AL-HASSAN");
    const lower = parse("mohammad");
    expect(lower.success && lower.data).toBe("MOHAMMAD");
  });

  it("keeps Arabic names as typed", () => {
    const r = parse(" محمد  علي ");
    expect(r.success && r.data).toBe("محمد علي");
  });

  it("accepts the punctuation names use", () => {
    for (const name of ["O'NEIL", "ABU-ALI", "M. KHALED"]) expect(parse(name).success, name).toBe(true);
  });

  it("refuses placeholders and blanks, saying why", () => {
    for (const v of ["N/A", "n/a", "unknown", "UNKNOWN", "-", "none", "0"]) {
      expect(error(v), v).toMatch(/placeholder/);
    }
    expect(error("   ")).toBe("Driver name is required");
  });

  it("refuses digits and symbols in a name", () => {
    expect(error("ALI 2")).toMatch(/only contain letters/);
    expect(error("ALI/OMAR")).toMatch(/only contain letters/);
  });
});

describe("truckNumberSchema", () => {
  const parse = (v: string) => truckNumberSchema.safeParse(v);
  const error = (v: string) => { const r = parse(v); return r.success ? null : r.error.issues[0].message; };

  it("stores plates as one run of capitals and digits", () => {
    expect(parse(" 60-70415 ").success && parse(" 60-70415 ").data).toBe("6070415");
    expect(parse("abc 1234").success && parse("abc 1234").data).toBe("ABC1234");
  });

  it("accepts local, older and foreign plate shapes", () => {
    for (const v of ["6070415", "607041", "60704", "12A34567", "A12345", "ABC1234"]) expect(parse(v).success, v).toBe(true);
  });

  it("refuses the placeholders found in the data", () => {
    for (const v of ["000000", "UNKNOWN", "N/A", "0"]) expect(error(v), v).toMatch(/placeholder/);
  });

  it("refuses symbols, and plates too short to be real", () => {
    expect(error("60/70415")).toBe("Only letters and numbers allowed");
    expect(error("123")).toBe("Truck number is too short");
  });
});

describe("truckNumberWarning", () => {
  it("is quiet for a 7-digit local plate, however it was typed", () => {
    expect(truckNumberWarning("6070415")).toBeNull();
    expect(truckNumberWarning("60-70415")).toBeNull();
  });

  it("asks for a second look at other shapes without refusing them", () => {
    for (const v of ["607041", "ABC1234"]) {
      expect(truckNumberWarning(v), v).toMatch(/7 digits/);
      expect(truckNumberSchema.safeParse(v).success, v).toBe(true);
    }
  });

  it("leaves invalid input to the error message", () => {
    expect(truckNumberWarning("")).toBeNull();
    expect(truckNumberWarning("UNKNOWN")).toBeNull();
  });
});

describe("gate schemas hand back the normalized driver and truck", () => {
  it("gate-in", () => {
    const r = gateInSchema.safeParse({ ...validGateIn, driverName: " ali  hassan ", truckNumber: "60-70415" });
    expect(r.success && r.data.driverName).toBe("ALI HASSAN");
    expect(r.success && r.data.truckNumber).toBe("6070415");
  });

  it("gate-out refuses a placeholder driver or truck", () => {
    const gateOut = { bookingNumber: "BK-1", sealNumber: "SL1", driverName: "Ali", truckNumber: "6070415", fees: "0" };
    expect(gateOutSchema.safeParse(gateOut).success).toBe(true);
    expect(gateOutSchema.safeParse({ ...gateOut, driverName: "unknown" }).success).toBe(false);
    expect(gateOutSchema.safeParse({ ...gateOut, truckNumber: "000000" }).success).toBe(false);
  });
});
