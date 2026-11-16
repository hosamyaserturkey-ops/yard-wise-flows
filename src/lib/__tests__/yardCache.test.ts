import { describe, expect, it } from "vitest";
import { cachedFor } from "../yardCache";

const lot = { id: "y2", name: "Car Lot", kind: "vehicle" };
const evl = { id: "y1", name: "Container Yard", kind: "container" };

describe("cachedFor", () => {
  it("reuses the list for the same user", () => {
    expect(cachedFor({ userId: "u1", yards: [lot] }, "u1")).toEqual([lot]);
  });

  it("never reuses a list loaded for someone else", () => {
    expect(cachedFor({ userId: "u1", yards: [evl] }, "u2")).toBeNull();
  });

  it("has nothing for nobody, even when a list is remembered", () => {
    expect(cachedFor({ userId: "u1", yards: [lot] }, null)).toBeNull();
    expect(cachedFor({ userId: "u1", yards: [lot] }, undefined)).toBeNull();
  });

  it("has nothing before anything was loaded", () => {
    expect(cachedFor(null, "u1")).toBeNull();
  });

  it("an empty list loaded for this user is a real answer, not 'not loaded'", () => {
    expect(cachedFor({ userId: "u1", yards: [] }, "u1")).toEqual([]);
  });

  it("signing in as a different person after a container user reloads, so a car-lot admin gets the car-lot yard", () => {
    const afterContainerUser = { userId: "container-user", yards: [evl] };
    expect(cachedFor(afterContainerUser, "car-lot-admin")).toBeNull();
  });
});
