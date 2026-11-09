import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

const { containerForGateIn } = await import("../containerForGateIn");

const input = {
  yardId: "yard-a",
  containerNumber: "MSKU1234567",
  containerType: "40HC",
  shippingLine: "MSK",
};

describe("containerForGateIn", () => {
  beforeEach(() => rpc.mockReset());

  it("calls container_for_gate_in with the yard, number, type and line, writing by default", async () => {
    rpc.mockResolvedValue({ data: "container-id", error: null });
    await expect(containerForGateIn(input)).resolves.toBe("container-id");
    expect(rpc).toHaveBeenCalledWith("container_for_gate_in", {
      _yard_id: "yard-a",
      _container_number: "MSKU1234567",
      _container_type: "40HC",
      _shipping_line: "MSK",
      _check_only: false,
    });
  });

  it("asks for a check only when told to, and gives null for a box no yard has seen", async () => {
    rpc.mockResolvedValue({ data: null, error: null });
    await expect(containerForGateIn(input, { checkOnly: true })).resolves.toBeNull();
    expect(rpc.mock.calls[0][1]).toMatchObject({ _check_only: true });
  });

  it("throws the database error as it is, so Gate In can show a check_violation's message", async () => {
    const error = { code: "23514", message: "MSKU1234567 is still gated in at another yard." };
    rpc.mockResolvedValue({ data: null, error });
    await expect(containerForGateIn(input)).rejects.toBe(error);
  });
});

// RLS hides a box whose records are all in another yard, so Gate In must not
// look the master row up, insert it or update it with a plain table call.
describe("Gate In and the containers table", () => {
  const src = readFileSync(resolve(__dirname, "../../pages/GateIn.tsx"), "utf8");

  it("goes through containerForGateIn, before demurrage and when saving", () => {
    expect(src.match(/containerForGateIn\(/g)?.length).toBe(2);
    expect(src).toMatch(/\{ checkOnly: true \}/);
  });

  it("does not read or write containers directly", () => {
    expect(src).not.toMatch(/\.from\(["']containers["']\)/);
  });
});
