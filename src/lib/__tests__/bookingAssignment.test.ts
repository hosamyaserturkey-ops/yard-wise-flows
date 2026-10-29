import { describe, expect, it } from "vitest";
import {
  assignedCount,
  assignmentState,
  countReservedByBooking,
  matchesAssignmentFilter,
} from "../bookingAssignment";

const booking = (total_containers: number, gated_out_containers = 0) => ({
  total_containers,
  gated_out_containers,
});

describe("countReservedByBooking", () => {
  it("counts reserved visits per booking and skips ones with no booking", () => {
    const counts = countReservedByBooking([
      { booking_id: "b1" },
      { booking_id: "b2" },
      { booking_id: "b1" },
      { booking_id: null },
    ]);
    expect(counts.get("b1")).toBe(2);
    expect(counts.get("b2")).toBe(1);
    expect(counts.size).toBe(2);
  });
});

describe("assignmentState", () => {
  it("is unassigned with nothing reserved or gated out", () => {
    expect(assignmentState(booking(3), 0)).toBe("unassigned");
  });

  it("counts reserved and gated-out containers together", () => {
    expect(assignedCount(booking(5, 2), 1)).toBe(3);
    expect(assignmentState(booking(5, 2), 1)).toBe("partial");
    expect(assignmentState(booking(3, 2), 1)).toBe("full");
    expect(assignmentState(booking(3, 3), 0)).toBe("full");
  });

  it("treats more assigned than booked as full", () => {
    expect(assignmentState(booking(2, 1), 2)).toBe("full");
  });
});

describe("matchesAssignmentFilter", () => {
  it("lets every booking through on 'any'", () => {
    expect(matchesAssignmentFilter(booking(3), 0, "any")).toBe(true);
    expect(matchesAssignmentFilter(booking(3, 3), 0, "any")).toBe(true);
  });

  it("matches the booking's assignment state", () => {
    expect(matchesAssignmentFilter(booking(3), 0, "unassigned")).toBe(true);
    expect(matchesAssignmentFilter(booking(3), 1, "unassigned")).toBe(false);
    expect(matchesAssignmentFilter(booking(3), 1, "partial")).toBe(true);
    expect(matchesAssignmentFilter(booking(3, 1), 2, "full")).toBe(true);
    expect(matchesAssignmentFilter(booking(3, 1), 2, "partial")).toBe(false);
  });

  it("'reserved' keeps only bookings with a container still waiting to gate out", () => {
    expect(matchesAssignmentFilter(booking(3, 1), 1, "reserved")).toBe(true);
    expect(matchesAssignmentFilter(booking(3, 3), 0, "reserved")).toBe(false);
    expect(matchesAssignmentFilter(booking(3), 0, "reserved")).toBe(false);
  });
});
