import { beforeEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { newUserMetadata } from "../../../supabase/functions/create-user/metadata.ts";

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

// Access (role, yard, line) must reach the database through app_metadata,
// which only the service role can write. user_metadata is whatever the caller
// of the public POST /auth/v1/signup put in `data`.
describe("create-user Edge Function: metadata for auth.admin.createUser", () => {
  const base = { fullName: "Yard Admin", username: "yardadmin", yard_id: "yard-1" };

  it("puts role and yard in app_metadata and only name and username in user_metadata", () => {
    expect(newUserMetadata({ ...base, role: "admin" })).toEqual({
      user_metadata: { full_name: "Yard Admin", username: "yardadmin" },
      app_metadata: { role: "admin", yard_id: "yard-1" },
    });
  });

  it("keeps a line rep's shipping line in app_metadata", () => {
    const { user_metadata, app_metadata } = newUserMetadata({
      ...base,
      role: "line_rep",
      shipping_line: "7Seas",
    });
    expect(app_metadata).toEqual({ role: "line_rep", yard_id: "yard-1", shipping_line: "7Seas" });
    expect(Object.keys(user_metadata).sort()).toEqual(["full_name", "username"]);
  });

  it("drops the shipping line for any other role", () => {
    const { app_metadata } = newUserMetadata({ ...base, role: "inspector", shipping_line: "EEL" });
    expect(app_metadata).not.toHaveProperty("shipping_line");
  });

  it("is how index.ts builds the metadata, not an inline object", () => {
    const src = readFileSync(
      resolve(__dirname, "../../../supabase/functions/create-user/index.ts"),
      "utf8",
    );
    expect(src).toContain("newUserMetadata(");
    expect(src).not.toMatch(/\b(user|app)_metadata\s*:/);
  });
});

// Migrations are applied by hand, so the last one to define handle_new_user is
// what production should be running.
describe("handle_new_user in the newest migration that defines it", () => {
  const dir = resolve(__dirname, "../../../supabase/migrations");
  const definition = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(resolve(dir, f), "utf8"))
    .flatMap((sql) =>
      [...sql.matchAll(/CREATE OR REPLACE FUNCTION public\.handle_new_user\(\)[\s\S]*?AS (\$\w*\$)([\s\S]*?)\1/g)]
        .map((m) => m[2]),
    )
    .at(-1) ?? "";

  it("is found", () => {
    expect(definition).toContain("INSERT INTO public.user_roles");
  });

  it("never takes role, yard or line from user_metadata", () => {
    expect(definition).not.toMatch(/raw_user_meta_data\s*->>?\s*'(role|yard_id|shipping_line)'/);
  });

  it("takes them from app_metadata", () => {
    for (const key of ["role", "yard_id", "shipping_line"]) {
      expect(definition).toMatch(new RegExp(`raw_app_meta_data\\s*->>\\s*'${key}'`));
    }
  });

  it("also handles the UPDATE that carries createUser's app_metadata", () => {
    // The Auth server inserts the user first and merges app_metadata in with a
    // later UPDATE, so an INSERT-only trigger would make every account a plain
    // 'user' with no yard (see 20261109120000).
    expect(definition, "handle_new_user must still handle TG_OP = 'UPDATE'").toMatch(/TG_OP\s*=\s*'UPDATE'/);
  });
});
