import { describe, expect, it } from "vitest";
import { pickRole } from "../roles";

describe("pickRole", () => {
  it("takes the highest-privilege role", () => {
    expect(pickRole(["user", "admin"])).toBe("admin");
    expect(pickRole(["inspector", "super_admin"])).toBe("super_admin");
  });

  it("never turns a car-lot role into a plain user", () => {
    expect(pickRole(["manufacturer_rep"])).toBe("manufacturer_rep");
    expect(pickRole(["read_only_admin"])).toBe("read_only_admin");
  });

  it("a read-only admin is not an admin", () => {
    expect(pickRole(["read_only_admin"])).not.toBe("admin");
  });

  it("defaults to user when there is no role row", () => {
    expect(pickRole([])).toBe("user");
    expect(pickRole(["something_unknown"])).toBe("user");
  });
});
