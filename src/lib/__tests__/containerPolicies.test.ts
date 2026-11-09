import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// The behaviour is checked against a database by
// supabase/checks/yard_scoped_access.sql. This only guards the migration files:
// they are applied by hand, so the last one to rewrite a policy is what
// production should have, and a later file that rewrote these policies could
// silently put the old open ones back.

const dir = resolve(__dirname, "../../../supabase/migrations");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((name) => ({ name, sql: readFileSync(resolve(dir, name), "utf8") }));

const SCOPING = "20261109130000_scope_containers_to_caller_yard.sql";
const POLICIES = [
  ["containers_select", "containers"],
  ["containers_insert", "containers"],
  ["containers_update", "containers"],
  ["profiles_insert_self", "profiles"],
] as const;

const touches = (sql: string, policy: string, table: string) =>
  new RegExp(`(ALTER|CREATE|DROP)\\s+POLICY\\s+(IF\\s+EXISTS\\s+)?"?${policy}"?\\s+ON\\s+(public\\.)?${table}\\b`, "i").test(
    // Ignore comments.
    sql.replace(/--.*$/gm, ""),
  );

describe("containers yard scoping in the migrations", () => {
  const scoping = files.find((f) => f.name === SCOPING)?.sql ?? "";

  it("exists", () => {
    expect(scoping).not.toBe("");
  });

  it.each(POLICIES)("%s is last rewritten by the yard-scoping migration", (policy, table) => {
    const rewriting = files.filter((f) => touches(f.sql, policy, table)).map((f) => f.name);
    expect(rewriting.at(-1)).toBe(SCOPING);
  });

  it("scopes reads and writes to the caller's yard through user_roles", () => {
    const body = scoping.replace(/--.*$/gm, "");
    for (const policy of ["containers_select", "containers_update"]) {
      const stmt = body.match(new RegExp(`ALTER POLICY ${policy}[\\s\\S]*?;`))?.[0] ?? "";
      expect(stmt).toContain("private.container_in_yard(");
      expect(stmt).toContain("private.caller_yard_with_role(");
    }
    const insert = body.match(/ALTER POLICY containers_insert[\s\S]*?;/)?.[0] ?? "";
    expect(insert).toContain("private.caller_yard_with_role(");
    // The policies call only the new helpers, never ones 20261011120000 moves
    // between schemas.
    expect(body).not.toMatch(/\b(public\.)?(is_super_admin|is_line_rep|has_role|current_yard_id|line_scope_ok)\(/);
  });
});
