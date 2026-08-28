// API routes bolted onto the everest-container-terminal static-assets Worker for storing
// new inspection photos in R2 (see wrangler.jsonc's `main` + `r2_buckets`).
// Everything else falls through to the static site via the ASSETS binding.
//
// Auth: has_role/is_super_admin are SECURITY DEFINER Postgres functions
// already granted EXECUTE to the `authenticated` role (see
// supabase/migrations), so we can check the caller's role by calling them
// with the caller's own JWT — no service-role key needed in this Worker at
// all, just the public URL + anon key (both already public in the built
// frontend).
import { ApmError, fetchEmptyReturns } from "./apmTerminals";
import { MAX_CONTAINERS_PER_LOOKUP } from "../src/lib/emptyReturns";

// Minimal local shapes for the Workers runtime bindings actually used here —
// not pulling in @cloudflare/workers-types as a real npm dependency keeps
// this file's package.json footprint at zero (Wrangler bundles/deploys this
// script via esbuild without type-checking it, so the package isn't needed
// for deployment, only for editor/tsc convenience).
interface R2Bucket {
  put(
    key: string,
    value: ReadableStream | ArrayBuffer | null,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<unknown>;
  get(key: string): Promise<{
    body: ReadableStream;
    httpMetadata?: { contentType?: string };
  } | null>;
  delete(keys: string | string[]): Promise<void>;
}
interface Fetcher {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  PHOTOS_BUCKET: R2Bucket;
  ASSETS: Fetcher;
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  // APM Terminals lookup (see handleEmptyReturns). The base URL and the
  // default facility are plain vars in wrangler.jsonc; the credentials are
  // Wrangler secrets, so they never reach the browser bundle. Production
  // needs them; the sandbox answers without.
  APM_BASE_URL?: string;
  APM_DEFAULT_FACILITY?: string;
  APM_CLIENT_ID?: string;
  APM_CLIENT_SECRET?: string;
}

const ALLOWED_UPLOAD_ROLES = ["inspector", "admin", "super_admin"] as const;
// Viewing is wider than uploading: any yard staff (including plain
// operators) may need to look at an inspection photo, matching the
// inspector_checks RLS SELECT policy (any account in the yard, including line
// reps scoped to their own line — the RLS query on inspector_checks already
// limits which photo keys a line rep's client ever requests).
const ALLOWED_VIEW_ROLES = ["inspector", "admin", "super_admin", "user", "line_rep"] as const;
// Deleting is yard-admin-only, matching the "only yard admin can delete a
// container" rule enforced on container_visits in the database.
const ALLOWED_DELETE_ROLES = ["admin", "super_admin"] as const;
// The terminal lookup is read-only and useful to whoever is standing at the
// gate, so it matches the (wider) photo-viewing list rather than the
// admin-only ones.
const ALLOWED_TERMINAL_ROLES = ALLOWED_VIEW_ROLES;

async function authorize(
  req: Request,
  env: Env,
  allowedRoles: readonly string[],
): Promise<{ userId: string } | Response> {
  const auth = req.headers.get("Authorization");
  if (!auth) return json({ error: "Missing auth" }, 401);

  const headers = {
    apikey: env.SUPABASE_ANON_KEY,
    Authorization: auth,
  };

  const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, { headers });
  if (!userRes.ok) return json({ error: "Not authenticated" }, 401);
  const { id: userId } = (await userRes.json()) as { id: string };
  if (!userId) return json({ error: "Not authenticated" }, 401);

  const superRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/rpc/is_super_admin`,
    {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ _uid: userId }),
    },
  );
  const isSuper = superRes.ok && (await superRes.json()) === true;

  let allowed = isSuper && allowedRoles.includes("super_admin");
  if (!allowed) {
    for (const role of allowedRoles) {
      if (role === "super_admin") continue;
      const roleRes = await fetch(
        `${env.SUPABASE_URL}/rest/v1/rpc/has_role`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({ _user_id: userId, _role: role }),
        },
      );
      if (roleRes.ok && (await roleRes.json()) === true) {
        allowed = true;
        break;
      }
    }
  }

  if (!allowed) return json({ error: "Not authorized" }, 403);
  return { userId };
}

async function handleUpload(req: Request, env: Env): Promise<Response> {
  const authResult = await authorize(req, env, ALLOWED_UPLOAD_ROLES);
  if (authResult instanceof Response) return authResult;

  const contentType = req.headers.get("Content-Type") || "application/octet-stream";
  const ext = contentType === "image/webp" ? "webp" : contentType.split("/")[1] || "bin";
  const key = `${authResult.userId}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;

  await env.PHOTOS_BUCKET.put(key, req.body, {
    httpMetadata: { contentType },
  });

  return json({ key });
}

async function handleView(req: Request, env: Env, url: URL): Promise<Response> {
  const authResult = await authorize(req, env, ALLOWED_VIEW_ROLES);
  if (authResult instanceof Response) return authResult;

  const key = url.searchParams.get("key");
  if (!key) return json({ error: "Missing key" }, 400);

  const object = await env.PHOTOS_BUCKET.get(key);
  if (!object) return json({ error: "Not found" }, 404);

  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
    },
  });
}

async function handleDelete(req: Request, env: Env): Promise<Response> {
  const authResult = await authorize(req, env, ALLOWED_DELETE_ROLES);
  if (authResult instanceof Response) return authResult;

  let keys: unknown;
  try {
    ({ keys } = (await req.json()) as { keys: unknown });
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!Array.isArray(keys) || keys.length === 0 || !keys.every((k) => typeof k === "string")) {
    return json({ error: "Expected a non-empty array of string keys" }, 400);
  }
  if (keys.length > 100) return json({ error: "Too many keys (max 100)" }, 400);

  await env.PHOTOS_BUCKET.delete(keys);
  return json({ deleted: keys.length });
}

// Asking APM Terminals whether a container's empty return is still open at a
// facility — the closest that API comes to "has this box gated in there yet?"
// (see src/lib/emptyReturns.ts for how the answer is read). Kept on the
// server so the API credentials stay out of the frontend bundle and so the
// browser never has to deal with the terminal's CORS policy.
const FACILITY_CODE_REGEX = /^[A-Z0-9]{3,12}$/;
// ISO 6346, same shape as CONTAINER_NUMBER_REGEX in src/lib/validation.ts —
// spelled out again here because that module pulls in zod and the "@/" alias,
// neither of which the Worker bundle should carry.
const CONTAINER_NUMBER_REGEX = /^[A-Z]{4}[0-9]{7}$/;

async function handleEmptyReturns(req: Request, env: Env, url: URL): Promise<Response> {
  const authResult = await authorize(req, env, ALLOWED_TERMINAL_ROLES);
  if (authResult instanceof Response) return authResult;

  const baseUrl = (env.APM_BASE_URL || "").replace(/\/+$/, "");
  if (!baseUrl) {
    return json(
      { error: "Terminal lookup is not configured on this deployment." },
      503,
    );
  }

  const containerNumbers = (url.searchParams.get("assetId") || "")
    .split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);
  if (containerNumbers.length === 0) {
    return json({ error: "Give at least one container number" }, 400);
  }
  if (containerNumbers.length > MAX_CONTAINERS_PER_LOOKUP) {
    return json(
      { error: `Too many containers (max ${MAX_CONTAINERS_PER_LOOKUP})` },
      400,
    );
  }
  const malformed = containerNumbers.find((c) => !CONTAINER_NUMBER_REGEX.test(c));
  if (malformed) {
    return json({ error: `"${malformed}" is not a container number` }, 400);
  }

  const facilityCode = (
    url.searchParams.get("facilityCode") || env.APM_DEFAULT_FACILITY || ""
  ).trim().toUpperCase();
  if (!FACILITY_CODE_REGEX.test(facilityCode)) {
    return json({ error: "A facility code is required (e.g. SEGOT)" }, 400);
  }

  try {
    const records = await fetchEmptyReturns(
      {
        baseUrl,
        clientId: env.APM_CLIENT_ID,
        clientSecret: env.APM_CLIENT_SECRET,
      },
      containerNumbers,
      facilityCode,
      { fetch, now: () => Date.now() },
    );
    return json({ facilityCode, checkedAt: new Date().toISOString(), records });
  } catch (err) {
    const status = err instanceof ApmError ? err.status : 502;
    const message = err instanceof Error ? err.message : "Terminal lookup failed";
    console.error("Empty-container-returns lookup failed:", message);
    return json({ error: message }, status);
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === "/api/photos/upload" && req.method === "POST") {
      return handleUpload(req, env);
    }
    if (url.pathname === "/api/photos/view" && req.method === "GET") {
      return handleView(req, env, url);
    }
    if (url.pathname === "/api/photos/delete" && req.method === "POST") {
      return handleDelete(req, env);
    }
    if (url.pathname === "/api/terminal/empty-returns" && req.method === "GET") {
      return handleEmptyReturns(req, env, url);
    }

    return env.ASSETS.fetch(req);
  },
};
