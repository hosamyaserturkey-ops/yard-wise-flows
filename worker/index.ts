// API routes bolted onto the everest-container-terminal static-assets Worker for storing
// new inspection photos in R2 (see wrangler.jsonc's `main` + `r2_buckets`).
// Everything else falls through to the static site via the ASSETS binding.
//
// Auth: the caller's roles are read from user_roles with the caller's own JWT.
// RLS lets every account read its own role rows, so no service-role key is
// needed in this Worker at all, just the public URL + anon key (both already
// public in the built frontend). The role helpers (is_super_admin, has_role)
// live in a schema the API doesn't expose, so they can't be called from here.
import { ApmError, fetchEmptyReturns } from "./apmTerminals";
import { MAX_CONTAINERS_PER_LOOKUP } from "../src/lib/emptyReturns";
import { isAppRoute, isPageRequest } from "./appRoutes";
import { runRetention } from "./retention";
import {
  ANGLE_PATTERN, MAX_NOTE_LENGTH, MAX_VEHICLE_PHOTO_BYTES, UUID_PATTERN,
  checkVehiclePhoto, isVehicleSideProfile, photoExtension, photoKey, sha256Hex,
} from "./vehiclePhotos";

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
  /** Car-lot inspection photos: a separate, private bucket. */
  VEHICLE_PHOTOS_BUCKET: R2Bucket;
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
  // Car-lot retention job (worker/retention.ts). The token is a Worker secret; the mode is a plain var.
  RETENTION_TOKEN?: string;
  RETENTION_MODE?: string;
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
  opts: { blockVehicleSide?: boolean } = {},
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

  // Filter on the caller's id: admins can read other accounts' roles too, and
  // only the caller's own count here.
  const rolesRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/user_roles?select=role&user_id=eq.${encodeURIComponent(userId)}`,
    { headers },
  );
  const roles = rolesRes.ok
    ? ((await rolesRes.json()) as { role: string }[]).map((r) => r.role)
    : [];

  if (!roles.some((role) => allowedRoles.includes(role))) {
    return json({ error: "Not authorized" }, 403);
  }

  // Car-lot staff and manufacturer logins share the container roles' names,
  // so keep them out of the container photos explicitly. The owner is exempt.
  if (opts.blockVehicleSide && !roles.includes("super_admin")) {
    const profileRes = await fetch(
      `${env.SUPABASE_URL}/rest/v1/profiles?select=manufacturer_id,yards(kind)&user_id=eq.${encodeURIComponent(userId)}`,
      { headers },
    );
    if (!profileRes.ok) return json({ error: "Not authorized" }, 403);
    const [profile] = (await profileRes.json()) as {
      manufacturer_id: string | null;
      yards: { kind: string } | null;
    }[];
    if (isVehicleSideProfile(profile ?? null)) return json({ error: "Not authorized" }, 403);
  }
  return { userId };
}

async function handleUpload(req: Request, env: Env): Promise<Response> {
  const authResult = await authorize(req, env, ALLOWED_UPLOAD_ROLES, { blockVehicleSide: true });
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
  const authResult = await authorize(req, env, ALLOWED_VIEW_ROLES, { blockVehicleSide: true });
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
  const authResult = await authorize(req, env, ALLOWED_DELETE_ROLES, { blockVehicleSide: true });
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


// ── Car-lot inspection photos ────────────────────────────────────────────
// Postgres decides who may add or see a photo, because every call below is
// made with the CALLER'S OWN login (RLS and the guard triggers apply). The
// browser never sends an object key: an upload gets its folder from
// vehicle_photo_upload_prefix(), and a view names a photo ROW, which only
// exists for the caller if row-level security lets them read it. There is no
// delete route: photos are evidence.
function userHeaders(req: Request, env: Env): Record<string, string> {
  return { apikey: env.SUPABASE_ANON_KEY, Authorization: req.headers.get("Authorization") ?? "" };
}

async function handleVehiclePhotoUpload(req: Request, env: Env, url: URL): Promise<Response> {
  if (!req.headers.get("Authorization")) return json({ error: "Missing auth" }, 401);
  const inspectionId = url.searchParams.get("inspection") ?? "";
  const angle = url.searchParams.get("angle") ?? "";
  const note = (url.searchParams.get("note") ?? "").trim();
  if (!UUID_PATTERN.test(inspectionId)) return json({ error: "Missing or invalid inspection" }, 400);
  if (!ANGLE_PATTERN.test(angle)) return json({ error: "Missing or invalid angle" }, 400);
  if (note.length > MAX_NOTE_LENGTH) return json({ error: "The note is too long" }, 400);

  const contentType = req.headers.get("Content-Type") || "";
  const declared = Number(req.headers.get("Content-Length") ?? "0");
  if (declared > MAX_VEHICLE_PHOTO_BYTES) return json({ error: "The photo is larger than 5 MB." }, 413);
  const bytes = await req.arrayBuffer();
  const problem = checkVehiclePhoto(contentType, bytes.byteLength);
  if (problem) return json({ error: problem }, bytes.byteLength > MAX_VEHICLE_PHOTO_BYTES ? 413 : 415);

  // 1. Ask Postgres, as the user, whether they may add to this inspection.
  const headers = userHeaders(req, env);
  const prefixRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/vehicle_photo_upload_prefix`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ _inspection_id: inspectionId }),
  });
  if (prefixRes.status === 401) return json({ error: "Not authenticated" }, 401);
  if (!prefixRes.ok) {
    const detail = (await prefixRes.json().catch(() => ({}))) as { message?: string };
    const closed = /closed/i.test(detail.message ?? "");
    return json({ error: closed ? "This inspection is closed." : "Not allowed to add photos here." }, closed ? 409 : 403);
  }
  const prefix = (await prefixRes.json()) as string;

  // 2. Store the file, then 3. record it as the user. If recording fails
  // (for example the inspection was closed meanwhile), remove the file again.
  const key = photoKey(prefix, crypto.randomUUID(), photoExtension(contentType));
  await env.VEHICLE_PHOTOS_BUCKET.put(key, bytes, { httpMetadata: { contentType: contentType.split(";")[0].trim() } });
  const sha = await sha256Hex(bytes);
  const insertRes = await fetch(`${env.SUPABASE_URL}/rest/v1/vehicle_inspection_photos`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", Prefer: "return=representation" },
    body: JSON.stringify({ inspection_id: inspectionId, angle, storage_path: key, file_sha256: sha, note: note || null }),
  });
  if (!insertRes.ok) {
    await env.VEHICLE_PHOTOS_BUCKET.delete(key);
    const detail = (await insertRes.json().catch(() => ({}))) as { message?: string };
    const closed = /closed/i.test(detail.message ?? "");
    return json({ error: closed ? "This inspection is closed." : "The photo could not be saved." }, closed ? 409 : 400);
  }
  const [row] = (await insertRes.json()) as { id: string }[];
  return json({ id: row?.id, sha256: sha });
}

async function handleVehiclePhotoView(req: Request, env: Env, url: URL): Promise<Response> {
  if (!req.headers.get("Authorization")) return json({ error: "Missing auth" }, 401);
  const id = url.searchParams.get("id") ?? "";
  if (!UUID_PATTERN.test(id)) return json({ error: "Missing or invalid id" }, 400);

  // The row is only returned if row-level security lets this user read it.
  const rowRes = await fetch(
    `${env.SUPABASE_URL}/rest/v1/vehicle_inspection_photos?select=storage_path&id=eq.${encodeURIComponent(id)}`,
    { headers: userHeaders(req, env) },
  );
  if (rowRes.status === 401) return json({ error: "Not authenticated" }, 401);
  if (!rowRes.ok) return json({ error: "Not found" }, 404);
  const [row] = (await rowRes.json()) as { storage_path: string }[];
  if (!row) return json({ error: "Not found" }, 404);

  const object = await env.VEHICLE_PHOTOS_BUCKET.get(row.storage_path);
  if (!object) return json({ error: "Not found" }, 404);
  return new Response(object.body, {
    headers: {
      "Content-Type": object.httpMetadata?.contentType || "application/octet-stream",
      "Cache-Control": "private, max-age=3600",
    },
  });
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
    const { records, raw } = await fetchEmptyReturns(
      {
        baseUrl,
        clientId: env.APM_CLIENT_ID,
        clientSecret: env.APM_CLIENT_SECRET,
      },
      containerNumbers,
      facilityCode,
      { fetch, now: () => Date.now() },
    );
    return json({ facilityCode, checkedAt: new Date().toISOString(), records, raw });
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
  // The daily cron trigger (wrangler.jsonc): car-lot retention. A failure is logged and
  // simply tried again the next day; it never affects the website.
  async scheduled(_event: unknown, env: Env): Promise<void> {
    try {
      await runRetention(env);
    } catch (e) {
      console.error("retention job failed:", e instanceof Error ? e.message : e);
    }
  },

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
    if (url.pathname === "/api/vehicle-photos/upload" && req.method === "POST") {
      return handleVehiclePhotoUpload(req, env, url);
    }
    if (url.pathname === "/api/vehicle-photos/view" && req.method === "GET") {
      return handleVehiclePhotoView(req, env, url);
    }
    if (url.pathname === "/api/terminal/empty-returns" && req.method === "GET") {
      return handleEmptyReturns(req, env, url);
    }
    if (url.pathname.startsWith("/api/")) {
      return json({ error: "Not found" }, 404);
    }

    const asset = await env.ASSETS.fetch(req);
    if (asset.status !== 404) return asset;
    if (isPageRequest(req, url)) return serveAppShell(url, env);
    // A missing file under /assets would otherwise carry that rule's
    // year-long "immutable" caching from public/_headers.
    const headers = new Headers(asset.headers);
    headers.set("Cache-Control", "no-store");
    return new Response(asset.body, { status: 404, statusText: "Not Found", headers });
  },
};

// The app's index.html for a page-like path that isn't a file: 200 for a route
// the app has, 404 (and kept out of search results) for anything else. The
// shell is fetched without the browser's conditional headers, so a 304 can't
// stand in for the page body of a 404.
async function serveAppShell(url: URL, env: Env): Promise<Response> {
  const shell = await env.ASSETS.fetch(
    new Request(new URL("/", url), { headers: { Accept: "text/html" } }),
  );
  if (isAppRoute(url.pathname)) return shell;
  const headers = new Headers(shell.headers);
  headers.delete("ETag");
  headers.set("X-Robots-Tag", "noindex");
  return new Response(shell.body, { status: 404, statusText: "Not Found", headers });
}
