// APM Terminals API client for the Worker: OAuth 2.0 client-credentials token
// handling plus the Empty Container Returns call.
//
// Kept out of worker/index.ts so the credentials only ever live server-side
// (Wrangler secrets) and the parsing stays shared with the frontend — the
// reading of the response lives in src/lib/emptyReturns.ts, which is pure and
// unit-tested.
//
// Sandbox (https://api-sandbox.apmterminals.com) serves test data without a
// token; production (https://api.apmterminals.com) requires one. Configure
// APM_CLIENT_ID / APM_CLIENT_SECRET and this module switches to authenticated
// calls on its own.
import {
  normalizeEmptyReturns,
  type EmptyReturnRecord,
} from "../src/lib/emptyReturns";

export interface ApmConfig {
  /** API root, no trailing slash. */
  baseUrl: string;
  clientId?: string;
  clientSecret?: string;
}

export interface ApmDeps {
  fetch: typeof fetch;
  now: () => number;
}

export class ApmError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = "ApmError";
  }
}

/** APM tokens last 30 minutes; refresh a minute early so none expires in flight. */
const TOKEN_SAFETY_MARGIN_MS = 60_000;
const DEFAULT_TOKEN_TTL_MS = 30 * 60_000;

interface CachedToken {
  token: string;
  expiresAt: number;
}

// Module scope, so a warm isolate reuses the token across requests instead of
// buying a new one per container lookup. Keyed by client id: a credential
// rotation gets its own entry rather than the stale one.
const tokenCache = new Map<string, CachedToken>();

/** Visible for tests — drops any cached token. */
export function clearTokenCache(): void {
  tokenCache.clear();
}

/**
 * A bearer token for production, or null when no credentials are configured
 * (the sandbox needs none).
 */
export async function getAccessToken(
  config: ApmConfig,
  deps: ApmDeps,
): Promise<string | null> {
  const { clientId, clientSecret } = config;
  if (!clientId || !clientSecret) return null;

  const cached = tokenCache.get(clientId);
  if (cached && cached.expiresAt > deps.now()) return cached.token;

  const body = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
  });
  const res = await deps.fetch(
    `${config.baseUrl}/oauth/client_credential/accesstoken?grant_type=client_credentials`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    },
  );
  if (!res.ok) {
    throw new ApmError(
      `APM Terminals rejected the credentials (${res.status})`,
      502,
    );
  }

  const payload = (await res.json()) as {
    access_token?: string;
    expires_in?: string | number;
  };
  const token = payload.access_token;
  if (!token) {
    throw new ApmError("APM Terminals returned no access token", 502);
  }

  // expires_in comes back in seconds, sometimes as a string.
  const ttlSeconds = Number(payload.expires_in);
  const ttlMs = Number.isFinite(ttlSeconds) && ttlSeconds > 0
    ? ttlSeconds * 1000
    : DEFAULT_TOKEN_TTL_MS;
  tokenCache.set(clientId, {
    token,
    expiresAt: deps.now() + Math.max(ttlMs - TOKEN_SAFETY_MARGIN_MS, 0),
  });
  return token;
}

/**
 * GET /empty-container-returns for up to a handful of containers at one
 * facility, returning the records the response carries.
 */
export async function fetchEmptyReturns(
  config: ApmConfig,
  containerNumbers: string[],
  facilityCode: string,
  deps: ApmDeps,
): Promise<EmptyReturnRecord[]> {
  const token = await getAccessToken(config, deps);

  const url = new URL(`${config.baseUrl}/empty-container-returns`);
  // The API takes the container numbers as one comma-separated assetId value.
  url.searchParams.set("assetId", containerNumbers.join(","));
  url.searchParams.set("facilityCode", facilityCode);

  const res = await deps.fetch(url.toString(), {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });

  if (res.status === 401 || res.status === 403) {
    throw new ApmError(
      "APM Terminals refused the request — check the API credentials and that the plan covers Empty Container Returns.",
      502,
    );
  }
  if (!res.ok) {
    throw new ApmError(`APM Terminals returned ${res.status}`, 502);
  }

  let payload: unknown;
  try {
    payload = await res.json();
  } catch {
    throw new ApmError("APM Terminals returned a non-JSON response", 502);
  }
  return normalizeEmptyReturns(payload);
}
