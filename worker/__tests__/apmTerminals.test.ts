import { beforeEach, describe, expect, it } from "vitest";
import {
  ApmError,
  clearTokenCache,
  fetchEmptyReturns,
  getAccessToken,
  type ApmDeps,
} from "../apmTerminals";

const SANDBOX = { baseUrl: "https://api-sandbox.apmterminals.com" };
const PRODUCTION = {
  baseUrl: "https://api.apmterminals.com",
  clientId: "test-key",
  clientSecret: "test-secret",
};

interface Call {
  url: string;
  init?: RequestInit;
}

/** A fetch stub that records calls and answers from a queue of responses. */
function stubFetch(responses: Array<() => Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    const next = responses.shift();
    if (!next) throw new Error(`Unexpected call to ${String(input)}`);
    return next();
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const depsFrom = (fetchImpl: typeof fetch, now = () => 1_000_000): ApmDeps => ({
  fetch: fetchImpl,
  now,
});

beforeEach(() => clearTokenCache());

describe("getAccessToken", () => {
  it("skips OAuth entirely when no credentials are configured", async () => {
    const { calls, fetchImpl } = stubFetch([]);
    await expect(getAccessToken(SANDBOX, depsFrom(fetchImpl))).resolves.toBeNull();
    expect(calls).toHaveLength(0);
  });

  it("posts form-encoded credentials to the client-credentials endpoint", async () => {
    const { calls, fetchImpl } = stubFetch([
      () => jsonResponse({ access_token: "tok-1", expires_in: "1799" }),
    ]);
    await expect(getAccessToken(PRODUCTION, depsFrom(fetchImpl))).resolves.toBe("tok-1");
    expect(calls[0].url).toBe(
      "https://api.apmterminals.com/oauth/client_credential/accesstoken?grant_type=client_credentials",
    );
    expect(calls[0].init?.method).toBe("POST");
    expect((calls[0].init?.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(String(calls[0].init?.body)).toBe(
      "client_id=test-key&client_secret=test-secret",
    );
  });

  it("reuses a cached token until it is close to expiry", async () => {
    const { calls, fetchImpl } = stubFetch([
      () => jsonResponse({ access_token: "tok-1", expires_in: 1799 }),
      () => jsonResponse({ access_token: "tok-2", expires_in: 1799 }),
    ]);
    let now = 0;
    const deps = depsFrom(fetchImpl, () => now);

    await getAccessToken(PRODUCTION, deps);
    now = 20 * 60_000; // 20 minutes in — still valid
    await expect(getAccessToken(PRODUCTION, deps)).resolves.toBe("tok-1");
    expect(calls).toHaveLength(1);

    now = 29 * 60_000 + 30_000; // inside the refresh margin
    await expect(getAccessToken(PRODUCTION, deps)).resolves.toBe("tok-2");
    expect(calls).toHaveLength(2);
  });

  it("surfaces rejected credentials as a bad-gateway ApmError", async () => {
    const { fetchImpl } = stubFetch([() => jsonResponse({ error: "nope" }, 401)]);
    await expect(getAccessToken(PRODUCTION, depsFrom(fetchImpl))).rejects.toMatchObject({
      name: "ApmError",
      status: 502,
    });
  });
});

describe("fetchEmptyReturns", () => {
  it("queries the sandbox unauthenticated, with the numbers comma-joined", async () => {
    const { calls, fetchImpl } = stubFetch([
      () => jsonResponse({ containers: [{ containerId: "MRKU7137914", accepted: true }] }),
    ]);
    const records = await fetchEmptyReturns(
      SANDBOX,
      ["MRKU7137914", "UACU8175070"],
      "SEGOT",
      depsFrom(fetchImpl),
    );

    expect(calls[0].url).toBe(
      "https://api-sandbox.apmterminals.com/empty-container-returns?assetId=MRKU7137914%2CUACU8175070&facilityCode=SEGOT",
    );
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(records).toHaveLength(1);
    expect(records[0].accepted).toBe(true);
  });

  it("sends the bearer token in production", async () => {
    const { calls, fetchImpl } = stubFetch([
      () => jsonResponse({ access_token: "tok-1", expires_in: 1799 }),
      () => jsonResponse([]),
    ]);
    await fetchEmptyReturns(PRODUCTION, ["MRKU7137914"], "USLAX", depsFrom(fetchImpl));
    expect((calls[1].init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok-1",
    );
  });

  it("explains a 403 rather than passing the bare status on", async () => {
    const { fetchImpl } = stubFetch([() => jsonResponse({}, 403)]);
    await expect(
      fetchEmptyReturns(SANDBOX, ["MRKU7137914"], "SEGOT", depsFrom(fetchImpl)),
    ).rejects.toThrow(/credentials and that the plan covers/);
  });

  it("reports an upstream failure as a 502", async () => {
    const { fetchImpl } = stubFetch([() => jsonResponse({}, 500)]);
    const error = await fetchEmptyReturns(
      SANDBOX,
      ["MRKU7137914"],
      "SEGOT",
      depsFrom(fetchImpl),
    ).catch((e) => e);
    expect(error).toBeInstanceOf(ApmError);
    expect((error as ApmError).status).toBe(502);
  });

  it("reports a non-JSON answer instead of throwing a parse error", async () => {
    const { fetchImpl } = stubFetch([
      () => new Response("<html>maintenance</html>", { status: 200 }),
    ]);
    await expect(
      fetchEmptyReturns(SANDBOX, ["MRKU7137914"], "SEGOT", depsFrom(fetchImpl)),
    ).rejects.toThrow(/non-JSON/);
  });
});
