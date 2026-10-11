import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { RECEIPT_PRINT_SCRIPT } from "@/lib/gateInReceipt";

// public/_headers, parsed into { "/path": { Header: value } }.
function parseHeaders(): Record<string, Record<string, string>> {
  const rules: Record<string, Record<string, string>> = {};
  let current: Record<string, string> | null = null;
  for (const line of readFileSync(resolve(__dirname, "../../../public/_headers"), "utf8").split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      current = rules[line.trim()] = {};
    } else if (current) {
      const i = line.indexOf(":");
      current[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
  }
  return rules;
}

const rules = parseHeaders();
const csp = rules["/*"]["Content-Security-Policy"];
const directive = (name: string) =>
  csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? "";

describe("public/_headers", () => {
  it("allows the gate ticket's print script by its hash", () => {
    // The ticket window inherits the CSP, so a changed script stops printing.
    const hash = createHash("sha256").update(RECEIPT_PRINT_SCRIPT).digest("base64");
    expect(directive("script-src")).toContain(`'sha256-${hash}'`);
  });

  it("lets the app reach its Supabase project", () => {
    const client = readFileSync(resolve(__dirname, "../../integrations/supabase/client.ts"), "utf8");
    const host = new URL(client.match(/SUPABASE_URL = "([^"]+)"/)![1]).host;
    expect(directive("connect-src")).toContain(`https://${host}`);
    expect(directive("connect-src")).toContain(`wss://${host}`);
  });

  it("never allows inline or eval'd scripts wholesale", () => {
    expect(directive("script-src")).not.toContain("'unsafe-inline'");
    expect(directive("script-src")).not.toContain("'unsafe-eval'");
  });

  it("caches hashed bundles for good and revalidates the app shell", () => {
    expect(rules["/assets/*"]["Cache-Control"]).toBe("public, max-age=31536000, immutable");
    expect(rules["/"]["Cache-Control"]).toBe("no-cache");
    expect(rules["/index.html"]["Cache-Control"]).toBe("no-cache");
    // Matching rules are joined, so a catch-all Cache-Control would be glued
    // onto the /assets/* value.
    expect(rules["/*"]["Cache-Control"]).toBeUndefined();
  });

  it("refuses to be framed", () => {
    expect(directive("frame-ancestors")).toBe("frame-ancestors 'none'");
    expect(rules["/*"]["X-Frame-Options"]).toBe("DENY");
  });
});
