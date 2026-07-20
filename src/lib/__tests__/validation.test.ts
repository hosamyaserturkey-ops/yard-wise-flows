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

  it("bounds free days to 0-365", () => {
    expect(gateInSchema.safeParse({ ...validGateIn, freeDays: "365" }).success).toBe(true);
    expect(gateInSchema.safeParse({ ...validGateIn, freeDays: "366" }).success).toBe(false);
    expect(gateInSchema.safeParse({ ...validGateIn, freeDays: "-1" }).success).toBe(false);
    expect(gateInSchema.safeParse({ ...validGateIn, freeDays: "abc" }).success).toBe(false);
  });

  it("rejects negative or non-numeric demurrage rates", () => {
    expect(gateInSchema.safeParse({ ...validGateIn, dailyDemurrage: "-5" }).success).toBe(false);
    expect(gateInSchema.safeParse({ ...validGateIn, dailyDemurrage: "abc" }).success).toBe(false);
    expect(gateInSchema.safeParse({ ...validGateIn, dailyDemurrage: "0" }).success).toBe(true);
  });
});

describe("gateOutSchema", () => {
  const validGateOut = { driverName: "Ali", truckNumber: "TRK1", fees: "120.50" };

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
