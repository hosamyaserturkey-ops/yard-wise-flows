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
//
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
}

const ALLOWED_UPLOAD_ROLES = ["inspector", "admin", "super_admin"] as const;
// Viewing is wider than uploading: any yard staff (including plain
// operators) may need to look at an inspection photo, matching the
// inspector_checks RLS SELECT policy (any non-line-rep account in the yard).
const ALLOWED_VIEW_ROLES = ["inspector", "admin", "super_admin", "user"] as const;
// Deleting is yard-admin-only, matching the "only yard admin can delete a
// container" rule enforced on container_visits in the database.
const ALLOWED_DELETE_ROLES = ["admin", "super_admin"] as const;

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

    return env.ASSETS.fetch(req);
  },
};
