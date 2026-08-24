import { describe, expect, it } from "vitest";
import { bookingMatchesLine, bookingOptionLabel, bookingsForLine } from "../bookingScope";
import type { Booking } from "@/types/booking";

const make = (over: Partial<Booking> = {}): Booking => ({
  id: "b1",
  booking_number: "OSLGAQJTAO000002",
  customer_name: "WORLD OF MILES",
  shipping_line: "WOM",
  total_containers: 3,
  gated_out_containers: 0,
  status: "active",
  created_by: "u1",
  yard_id: "y1",
  created_at: new Date("2026-08-01"),
  updated_at: new Date("2026-08-01"),
  ...over,
});

describe("bookingMatchesLine", () => {
  it("keeps a booking on the container's own line", () => {
    expect(bookingMatchesLine(make({ shipping_line: "WOM" }), "WOM")).toBe(true);
    expect(bookingMatchesLine(make({ shipping_line: "EEL" }), "EEL")).toBe(true);
  });

  it("rejects a booking belonging to another line", () => {
    expect(bookingMatchesLine(make({ shipping_line: "WOM" }), "EEL")).toBe(false);
    expect(bookingMatchesLine(make({ shipping_line: "EEL" }), "WOM")).toBe(false);
  });

  it("compares case- and whitespace-insensitively", () => {
    expect(bookingMatchesLine(make({ shipping_line: " wom " }), "WOM")).toBe(true);
    expect(bookingMatchesLine(make({ shipping_line: "WOM" }), "wom")).toBe(true);
  });

  it("lets a legacy booking with no line on file be used for any line", () => {
    expect(bookingMatchesLine(make({ shipping_line: null }), "EEL")).toBe(true);
    expect(bookingMatchesLine(make({ shipping_line: "" }), "WOM")).toBe(true);
  });

  it("rejects a lined booking when the container's line is unknown", () => {
    expect(bookingMatchesLine(make({ shipping_line: "WOM" }), null)).toBe(false);
    expect(bookingMatchesLine(make({ shipping_line: "WOM" }), undefined)).toBe(false);
    expect(bookingMatchesLine(make({ shipping_line: "WOM" }), "")).toBe(false);
  });
});

describe("bookingsForLine", () => {
  const wom = make({ id: "b1", shipping_line: "WOM" });
  const eel = make({ id: "b2", shipping_line: "EEL", booking_number: "EEL-99" });
  const legacy = make({ id: "b3", shipping_line: null, booking_number: "OLD-1" });

  it("offers an EEL container only the EEL and unassigned bookings", () => {
    expect(bookingsForLine([wom, eel, legacy], "EEL").map((b) => b.id)).toEqual(["b2", "b3"]);
  });

  it("offers a WOM container only the WOM and unassigned bookings", () => {
    expect(bookingsForLine([wom, eel, legacy], "WOM").map((b) => b.id)).toEqual(["b1", "b3"]);
  });

  it("returns nothing when no booking fits the line", () => {
    expect(bookingsForLine([wom, eel], "SLD")).toEqual([]);
  });

  it("leaves an empty list empty", () => {
    expect(bookingsForLine([], "WOM")).toEqual([]);
  });
});

describe("bookingOptionLabel", () => {
  it("names the line and the progress", () => {
    expect(bookingOptionLabel(make({ gated_out_containers: 1 }))).toBe(
      "OSLGAQJTAO000002 — WORLD OF MILES (WOM, 1/3 out)",
    );
  });

  it("flags a booking with no line on file", () => {
    expect(bookingOptionLabel(make({ shipping_line: null }))).toBe(
      "OSLGAQJTAO000002 — WORLD OF MILES (line not set, 0/3 out)",
    );
  });
});
