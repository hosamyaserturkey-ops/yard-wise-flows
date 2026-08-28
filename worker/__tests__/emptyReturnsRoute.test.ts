import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../index";

// The route's own fetches (Supabase for the caller's role, APM for the data)
// all go through global fetch, so one stub keyed on URL serves both.
const realFetch = globalThis.fetch;

function stubGlobalFetch(apm: (url: string) => Response, authorized = true) {
  const seen: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    seen.push(url);
    if (url.endsWith("/auth/v1/user")) {
      return new Response(JSON.stringify({ id: "user-1" }), { status: 200 });
    }
    if (url.includes("/rpc/is_super_admin")) {
      return new Response(JSON.stringify(false), { status: 200 });
    }
    if (url.includes("/rpc/has_role")) {
      return new Response(JSON.stringify(authorized), { status: 200 });
    }
    return apm(url);
  }) as typeof fetch;
  return seen;
}

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.restoreAllMocks();
});

const env = (over: Partial<Env> = {}): Env =>
  ({
    SUPABASE_URL: "https://supabase.test",
    SUPABASE_ANON_KEY: "anon",
    APM_BASE_URL: "https://api-sandbox.apmterminals.com",
    APM_DEFAULT_FACILITY: "SEGOT",
    ...over,
  }) as Env;

const call = (query: string, environment = env(), headers: HeadersInit = { Authorization: "Bearer jwt" }) =>
  worker.fetch(
    new Request(`https://yard.test/api/terminal/empty-returns?${query}`, { headers }),
    environment,
  );

describe("GET /api/terminal/empty-returns", () => {
  it("returns the terminal's records for a valid lookup", async () => {
    stubGlobalFetch(() =>
      new Response(
        JSON.stringify({ containers: [{ containerId: "MRKU7137914", accepted: true }] }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );
    const res = await call("assetId=MRKU7137914");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.facilityCode).toBe("SEGOT");
    expect(body.records[0].containerNumber).toBe("MRKU7137914");
  });

  it("falls back to the configured facility only when none is given", async () => {
    const seen = stubGlobalFetch(() =>
      new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    await call("assetId=MRKU7137914&facilityCode=uslax");
    const apmCall = seen.find((u) => u.includes("empty-container-returns"))!;
    expect(apmCall).toContain("facilityCode=USLAX");
  });

  it("rejects a malformed container number before calling the terminal", async () => {
    const seen = stubGlobalFetch(() => new Response("[]", { status: 200 }));
    const res = await call("assetId=NOTACONTAINER");
    expect(res.status).toBe(400);
    expect(seen.some((u) => u.includes("empty-container-returns"))).toBe(false);
  });

  it("rejects more containers than one lookup allows", async () => {
    stubGlobalFetch(() => new Response("[]", { status: 200 }));
    const many = Array.from({ length: 11 }, (_, i) => `MRKU713791${i % 10}`).join(",");
    const res = await call(`assetId=${many}`);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("max 10");
  });

  it("says so when the deployment has no APM base URL configured", async () => {
    stubGlobalFetch(() => new Response("[]", { status: 200 }));
    const res = await call("assetId=MRKU7137914", env({ APM_BASE_URL: "" }));
    expect(res.status).toBe(503);
  });

  it("turns an upstream failure into a 502 with a reason", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubGlobalFetch(() => new Response("boom", { status: 500 }));
    const res = await call("assetId=MRKU7137914");
    expect(res.status).toBe(502);
    expect((await res.json()).error).toContain("500");
  });

  it("refuses a caller without a yard role", async () => {
    stubGlobalFetch(() => new Response("[]", { status: 200 }), false);
    const res = await call("assetId=MRKU7137914");
    expect(res.status).toBe(403);
  });

  it("refuses an unauthenticated caller", async () => {
    stubGlobalFetch(() => new Response("[]", { status: 200 }));
    const res = await call("assetId=MRKU7137914", env(), {});
    expect(res.status).toBe(401);
  });
});
