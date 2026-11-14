import { afterEach, describe, expect, it, vi } from "vitest";
import worker, { type Env } from "../index";
import { runRetention, type RetentionEnv } from "../retention";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; vi.restoreAllMocks(); });

type Call = { name: string; body: Record<string, unknown>; headers: Record<string, string> };

function stubDb(handlers: { run?: unknown; ack?: unknown; runStatus?: number }) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const name = String(input).split("/rpc/")[1];
    calls.push({ name, body: JSON.parse(String(init?.body)), headers: Object.fromEntries(new Headers(init?.headers).entries()) });
    if (name === "car_lot_retention_run") return new Response(JSON.stringify(handlers.run), { status: handlers.runStatus ?? 200 });
    return new Response(JSON.stringify(handlers.ack ?? 0), { status: 200 });
  }) as typeof fetch;
  return calls;
}

const bucket = (fail = false) => ({ delete: vi.fn(async () => { if (fail) throw new Error("R2 down"); }) });
const env = (over: Partial<RetentionEnv> = {}): RetentionEnv & { VEHICLE_PHOTOS_BUCKET: ReturnType<typeof bucket> } =>
  ({ SUPABASE_URL: "https://supabase.test", SUPABASE_ANON_KEY: "anon", RETENTION_TOKEN: "tok", VEHICLE_PHOTOS_BUCKET: bucket(), ...over }) as never;
const run = (files: string[], over: Record<string, unknown> = {}) =>
  ({ mode: "report", candidates: 2, deleted_visits: 0, files, ...over });

describe("runRetention", () => {
  it("does nothing without the secret token", async () => {
    const calls = stubDb({});
    const result = await runRetention(env({ RETENTION_TOKEN: undefined }));
    expect(result.ran).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("only reports unless the mode is exactly \"delete\"", async () => {
    for (const mode of [undefined, "", "report", "DELETE", "true", "delete "]) {
      const calls = stubDb({ run: run([]) });
      await runRetention(env({ RETENTION_MODE: mode }));
      expect(calls[0].body, String(mode)).toEqual({ _token: "tok", _dry_run: true });
    }
  });

  it("asks to delete when the mode is \"delete\"", async () => {
    const calls = stubDb({ run: run([], { mode: "delete", deleted_visits: 2 }) });
    const result = await runRetention(env({ RETENTION_MODE: "delete" }));
    expect(calls[0].body).toEqual({ _token: "tok", _dry_run: false });
    expect(result).toMatchObject({ ran: true, mode: "delete", deletedVisits: 2 });
  });

  it("calls Postgres with the public key and the token, never a service key", async () => {
    const calls = stubDb({ run: run([]) });
    await runRetention(env());
    expect(calls[0].headers.apikey).toBe("anon");
    expect(calls[0].headers.authorization).toBe("Bearer anon");
  });

  it("deletes the files it is handed, then confirms exactly those", async () => {
    const calls = stubDb({ run: run(["a/1.jpg", "a/2.jpg"], { mode: "delete", deleted_visits: 1 }) });
    const e = env({ RETENTION_MODE: "delete" });
    const result = await runRetention(e);
    expect(e.VEHICLE_PHOTOS_BUCKET.delete).toHaveBeenCalledWith(["a/1.jpg", "a/2.jpg"]);
    expect(calls.map((c) => c.name)).toEqual(["car_lot_retention_run", "car_lot_retention_ack"]);
    expect(calls[1].body).toEqual({ _token: "tok", _keys: ["a/1.jpg", "a/2.jpg"] });
    expect(result.filesDeleted).toBe(2);
  });

  it("confirms nothing when the files could not be deleted, so the database hands them out again", async () => {
    const calls = stubDb({ run: run(["a/1.jpg"], { mode: "delete" }) });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const result = await runRetention(env({ RETENTION_MODE: "delete", VEHICLE_PHOTOS_BUCKET: bucket(true) }));
    expect(calls.map((c) => c.name)).toEqual(["car_lot_retention_run"]);
    expect(result).toMatchObject({ filesDeleted: 0, filesFailed: 1 });
  });

  it("works through a long list in chunks of 100", async () => {
    const files = Array.from({ length: 250 }, (_, i) => `k/${i}.jpg`);
    const calls = stubDb({ run: run(files, { mode: "delete" }) });
    const e = env({ RETENTION_MODE: "delete" });
    await runRetention(e);
    expect(e.VEHICLE_PHOTOS_BUCKET.delete.mock.calls.map((c) => (c[0] as string[]).length)).toEqual([100, 100, 50]);
    expect(calls.filter((c) => c.name === "car_lot_retention_ack")).toHaveLength(3);
  });

  it("throws when Postgres refuses (a wrong token), and touches no file", async () => {
    stubDb({ run: { message: "invalid retention token" }, runStatus: 403 });
    const e = env();
    await expect(runRetention(e)).rejects.toThrow(/403/);
    expect(e.VEHICLE_PHOTOS_BUCKET.delete).not.toHaveBeenCalled();
  });
});

describe("scheduled handler", () => {
  it("runs the job and never throws, so a failure cannot affect the website", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    stubDb({ run: { message: "boom" }, runStatus: 500 });
    await expect(worker.scheduled({}, env() as unknown as Env)).resolves.toBeUndefined();
  });

  it("is wired to a daily cron in wrangler.jsonc, in report mode", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const cfg = readFileSync(resolve(__dirname, "../../wrangler.jsonc"), "utf8");
    expect(cfg).toMatch(/"crons":\s*\["17 3 \* \* \*"\]/);
    expect(cfg).toMatch(/"RETENTION_MODE":\s*"report"/);
  });
});
