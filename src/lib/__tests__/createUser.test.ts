import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));

const { createUser, validateNewUser, MIN_PASSWORD_LENGTH } = await import("../createUser");

const validRep = {
  fullName: "EEL Shipping line rep",
  username: "eelrep",
  password: "a-long-enough-password",
  role: "line_rep" as const,
  shipping_line: "EEL",
};

describe("validateNewUser", () => {
  it("accepts a complete line rep", () => {
    expect(validateNewUser(validRep)).toBeNull();
  });

  it("rejects a password shorter than the Edge Function's minimum", () => {
    const short = "x".repeat(MIN_PASSWORD_LENGTH - 1);
    expect(validateNewUser({ ...validRep, password: short })).toMatch(/at least/i);
  });

  it("rejects a line rep with no shipping line", () => {
    expect(validateNewUser({ ...validRep, shipping_line: "" })).toMatch(/shipping line/i);
  });

  it("rejects a username with illegal characters", () => {
    expect(validateNewUser({ ...validRep, username: "eel rep!" })).toMatch(/username/i);
  });

  it("does not require a shipping line for other roles", () => {
    expect(validateNewUser({ ...validRep, role: "user", shipping_line: "" })).toBeNull();
  });
});

describe("createUser", () => {
  beforeEach(() => invoke.mockReset());

  it("returns null when the function succeeds", async () => {
    invoke.mockResolvedValue({ data: { ok: true, user_id: "abc" }, error: null });
    expect(await createUser({ ...validRep, yard_id: "yard-1" })).toBeNull();
  });

  it("surfaces the error body of a non-2xx response instead of the generic message", async () => {
    const error = Object.assign(
      new Error("Edge Function returned a non-2xx status code"),
      { context: new Response(JSON.stringify({ error: "Username already taken" }), { status: 409 }) },
    );
    invoke.mockResolvedValue({ data: null, error });
    expect(await createUser({ ...validRep, yard_id: "yard-1" })).toBe("Username already taken");
  });

  it("falls back to the error message when the response has no JSON body", async () => {
    const error = Object.assign(new Error("Failed to fetch"), { context: undefined });
    invoke.mockResolvedValue({ data: null, error });
    expect(await createUser({ ...validRep, yard_id: "yard-1" })).toBe("Failed to fetch");
  });

  it("omits shipping_line for non-rep roles", async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    await createUser({ ...validRep, role: "user", yard_id: "yard-1" });
    expect(invoke.mock.calls[0][1].body.shipping_line).toBeUndefined();
  });
});
