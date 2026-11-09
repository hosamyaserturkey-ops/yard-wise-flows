import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// containers is shared by every yard, so its permissive policies don't scope
// rows to a yard. containers_staff_only (20261109200000) is the gate that
// keeps an account with no yard (a public sign-up, say) out of it entirely.
// Migrations are applied by hand, so the last one to mention the policy is
// what production should have.
describe("containers_staff_only in the newest migration that mentions it", () => {
  const dir = resolve(__dirname, "../../../supabase/migrations");
  const sql = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(resolve(dir, f), "utf8"))
    .filter((text) => text.includes("containers_staff_only"))
    .at(-1) ?? "";

  it("is created, not just dropped", () => {
    expect(sql).toMatch(/CREATE POLICY containers_staff_only ON public\.containers/);
  });

  it("is restrictive and covers every command", () => {
    expect(sql).toMatch(/containers_staff_only ON public\.containers AS RESTRICTIVE FOR ALL TO authenticated/);
  });

  it("lets in super admins and accounts with a yard, and nobody else", () => {
    expect(sql).toMatch(/is_super_admin\(\(SELECT auth\.uid\(\)\)\)\) OR \(\(SELECT %s\.current_yard_id\(\)\) IS NOT NULL\)/);
  });
});
