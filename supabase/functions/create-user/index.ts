import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Payload {
  username: string;
  password: string;
  fullName: string;
  role: "admin" | "user" | "inspector";
  yard_id: string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Missing auth" }, 401);

    const callerClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: auth } },
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) return json({ error: "Not authenticated" }, 401);

    const body = (await req.json()) as Payload;
    const username = (body.username || "").trim().toLowerCase();
    const password = body.password || "";
    const fullName = (body.fullName || "").trim();
    const role = body.role;
    const yard_id = body.yard_id;

    if (!username || !password || !fullName || !role || !yard_id) {
      return json({ error: "Missing fields" }, 400);
    }
    if (!/^[a-z0-9_]+$/.test(username) || username.length < 3) {
      return json({ error: "Invalid username" }, 400);
    }
    if (password.length < 10) return json({ error: "Password must be at least 10 characters" }, 400);
    if (role !== "admin" && role !== "user" && role !== "inspector") {
      return json({ error: "Invalid role" }, 400);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Authorization: super_admin can create any role; yard admins can create
    // 'user' or 'inspector' in their own yard.
    const { data: isSuper, error: isSuperErr } = await admin.rpc(
      "is_super_admin",
      { _uid: caller.id },
    );
    if (isSuperErr) {
      console.error("is_super_admin RPC failed:", isSuperErr);
      return json(
        { error: `Authorization check failed: ${isSuperErr.message}` },
        500,
      );
    }
    if (!isSuper) {
      if (role === "admin") {
        return json({ error: "Only super-admins can create admins" }, 403);
      }
      const { data: isYardAdmin, error: isYardAdminErr } = await admin.rpc(
        "is_yard_admin",
        { _uid: caller.id, _yard: yard_id },
      );
      if (isYardAdminErr) {
        console.error("is_yard_admin RPC failed:", isYardAdminErr);
        return json(
          { error: `Authorization check failed: ${isYardAdminErr.message}` },
          500,
        );
      }
      if (!isYardAdmin) {
        return json({ error: "Not a yard admin for this yard" }, 403);
      }
    }

    // profiles.username has a UNIQUE constraint, and so does auth.users.email
    // (since email is derived from username). A duplicate would otherwise
    // surface as an opaque "Database error saving new user" after the auth
    // user is partially created. Catch it up front.
    const { data: existingProfile, error: dupErr } = await admin
      .from("profiles")
      .select("id")
      .eq("username", username)
      .maybeSingle();
    if (dupErr) {
      console.error("Username lookup failed:", dupErr);
      return json({ error: `Username check failed: ${dupErr.message}` }, 500);
    }
    if (existingProfile) {
      return json({ error: "Username already taken" }, 409);
    }

    const email = `${username}@containeryard.app`;
    const { data: created, error: createErr } = await admin.auth.admin
      .createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: fullName, username, role, yard_id },
      });
    if (createErr) {
      console.error("createUser failed:", createErr);
      return json({ error: createErr.message }, 400);
    }

    return json({ ok: true, user_id: created.user?.id });
  } catch (e) {
    console.error("create-user unexpected error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
