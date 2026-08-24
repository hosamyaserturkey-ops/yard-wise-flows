import { describe, expect, it } from "vitest";
import { bookingSchema, gateInSchema, gateOutSchema } from "../validation";

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
    total_containers: 12,
  };

  it("accepts a valid booking", () => {
    expect(bookingSchema.safeParse(validBooking).success).toBe(true);
  });

  it("rejects booking numbers with spaces or symbols", () => {
    expect(bookingSchema.safeParse({ ...validBooking, booking_number: "BK 001" }).success).toBe(false);
    expect(bookingSchema.safeParse({ ...validBooking, booking_number: "BK#001" }).success).toBe(false);
  });

  it("requires at least one whole container", () => {
    expect(bookingSchema.safeParse({ ...validBooking, total_containers: 0 }).success).toBe(false);
    expect(bookingSchema.safeParse({ ...validBooking, total_containers: 2.5 }).success).toBe(false);
    expect(bookingSchema.safeParse({ ...validBooking, total_containers: 10001 }).success).toBe(false);
  });
});
