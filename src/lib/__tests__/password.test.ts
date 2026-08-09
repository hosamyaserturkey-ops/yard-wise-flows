import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
const signInWithPassword = vi.fn();
const updateUser = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    auth: {
      signInWithPassword: (...args: unknown[]) => signInWithPassword(...args),
      updateUser: (...args: unknown[]) => updateUser(...args),
    },
  },
}));

const { changeOwnPassword, resetUserPassword, validatePassword, MIN_PASSWORD_LENGTH } =
  await import("../password");

const strong = "a-long-enough-password";
const change = {
  username: "eelrep",
  currentPassword: "the-old-password",
  newPassword: strong,
  confirmPassword: strong,
};

describe("validatePassword", () => {
  it("accepts a long enough password", () => {
    expect(validatePassword(strong)).toBeNull();
  });

  it("rejects one below the minimum", () => {
    expect(validatePassword("x".repeat(MIN_PASSWORD_LENGTH - 1))).toMatch(/at least/i);
  });
});

describe("changeOwnPassword", () => {
  beforeEach(() => {
    signInWithPassword.mockReset();
    updateUser.mockReset();
    signInWithPassword.mockResolvedValue({ error: null });
    updateUser.mockResolvedValue({ error: null });
  });

  it("verifies the current password, then updates", async () => {
    expect(await changeOwnPassword(change)).toBeNull();
    expect(signInWithPassword).toHaveBeenCalledWith({
      email: "eelrep@containeryard.app",
      password: "the-old-password",
    });
    expect(updateUser).toHaveBeenCalledWith({ password: strong });
  });

  it("reports a wrong current password without touching the account", async () => {
    signInWithPassword.mockResolvedValue({ error: new Error("Invalid login credentials") });
    expect(await changeOwnPassword(change)).toMatch(/current password is incorrect/i);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("rejects mismatched confirmation before verifying anything", async () => {
    const result = await changeOwnPassword({ ...change, confirmPassword: "something-else" });
    expect(result).toMatch(/do not match/i);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("rejects a new password below the minimum", async () => {
    const short = "x".repeat(MIN_PASSWORD_LENGTH - 1);
    const result = await changeOwnPassword({ ...change, newPassword: short, confirmPassword: short });
    expect(result).toMatch(/at least/i);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });

  it("rejects reusing the current password", async () => {
    const result = await changeOwnPassword({
      ...change,
      newPassword: change.currentPassword,
      confirmPassword: change.currentPassword,
    });
    expect(result).toMatch(/differ/i);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("requires the current password", async () => {
    const result = await changeOwnPassword({ ...change, currentPassword: "" });
    expect(result).toMatch(/current password/i);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
});

describe("resetUserPassword", () => {
  beforeEach(() => invoke.mockReset());

  it("returns null when the function succeeds", async () => {
    invoke.mockResolvedValue({ data: { ok: true }, error: null });
    expect(await resetUserPassword("user-1", strong)).toBeNull();
    expect(invoke).toHaveBeenCalledWith("reset-user-password", {
      body: { user_id: "user-1", password: strong },
    });
  });

  it("rejects a short password without calling the function", async () => {
    expect(await resetUserPassword("user-1", "short")).toMatch(/at least/i);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("surfaces the function's reason for refusing", async () => {
    const error = Object.assign(
      new Error("Edge Function returned a non-2xx status code"),
      {
        context: new Response(
          JSON.stringify({ error: "Only super-admins can reset an admin's password" }),
          { status: 403 },
        ),
      },
    );
    invoke.mockResolvedValue({ data: null, error });
    expect(await resetUserPassword("user-1", strong)).toBe(
      "Only super-admins can reset an admin's password",
    );
  });
});
