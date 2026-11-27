import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// Gate operators (role user) add and update their own yard's port data
// (20261127120000). The behaviour is checked against a database by
// supabase/checks/operators_port_data.sql. This only guards the migration
// files: they are applied by hand, so the last one to rewrite a policy is what
// production should have, and a later file could silently take the operators'
// access away again, or widen deletes.

const dir = resolve(__dirname, "../../../supabase/migrations");
const files = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((name) => ({ name, sql: readFileSync(resolve(dir, name), "utf8").replace(/--.*$/gm, "") }));

const OPERATORS = "20261127120000_operators_manage_port_data.sql";

const touches = (sql: string, policy: string) =>
  new RegExp(`(ALTER|CREATE|DROP)\\s+POLICY\\s+(IF\\s+EXISTS\\s+)?"?${policy}"?\\s+ON\\s+(public\\.)?container_port_data\\b`, "i").test(sql);

const lastTouching = (policy: string) => files.filter((f) => touches(f.sql, policy)).at(-1);

const statement = (sql: string, policy: string) =>
  sql.match(new RegExp(`ALTER POLICY ${policy} ON public\\.container_port_data[\\s\\S]*?;`))?.[0] ?? "";

describe("container_port_data write policies", () => {
  it.each(["cpd_insert", "cpd_update"])("%s is last rewritten by the operators migration", (policy) => {
    expect(lastTouching(policy)?.name).toBe(OPERATORS);
  });

  it.each(["cpd_insert", "cpd_update"])("%s lets gate operators write, still scoped to their yard", (policy) => {
    const stmt = statement(files.find((f) => f.name === OPERATORS)?.sql ?? "", policy);
    expect(stmt).toContain("private.has_role((SELECT auth.uid()), 'user'::public.app_role)");
    expect(stmt).toContain("yard_id = (SELECT private.current_yard_id())");
    // Admins and line reps keep the access they had.
    expect(stmt).toContain("private.is_yard_admin((SELECT auth.uid()), yard_id)");
    expect(stmt).toContain("private.is_line_rep((SELECT auth.uid()))");
  });

  it("cpd_update checks both the row before and after the change", () => {
    const stmt = statement(files.find((f) => f.name === OPERATORS)?.sql ?? "", "cpd_update");
    expect(stmt).toMatch(/USING \(/);
    expect(stmt).toMatch(/WITH CHECK \(/);
  });

  it("deleting port data stays with admins", () => {
    const last = lastTouching("cpd_delete");
    expect(last).toBeDefined();
    expect((last?.name ?? "") < OPERATORS).toBe(true);
    expect(statement(last?.sql ?? "", "cpd_delete")).not.toContain("has_role");
  });
});
