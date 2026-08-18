import { describe, it, expect } from "vitest";
import {
  CONTAINER_TYPES,
  CONTAINER_SIZES,
  typesForSize,
} from "@/lib/containerTypes";

describe("typesForSize", () => {
  it("puts every offered type under exactly one size", () => {
    // Guards the inspector's picker against a future code (say 53HC) that no
    // size would list, quietly making it un-inspectable.
    for (const type of CONTAINER_TYPES) {
      const owners = CONTAINER_SIZES.filter((s) =>
        typesForSize(s.code).some((t) => t.code === type.code),
      );
      expect(owners.map((o) => o.code), `${type.code} sizes`).toHaveLength(1);
    }
  });

  it("lists the tank alongside the other 20ft types", () => {
    const codes = typesForSize("20").map((t) => t.code);
    expect(codes).toContain("20TK");
    expect(codes).toContain("20GP");
    expect(codes.every((c) => c.startsWith("20"))).toBe(true);
  });

  it("returns nothing for a size the app doesn't offer", () => {
    expect(typesForSize("53")).toEqual([]);
  });
});
