import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { newUserMetadata } from "./metadata.ts";

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
  role: "admin" | "user" | "inspector" | "line_rep" | "read_only_admin" | "manufacturer_rep";
  /** Required for every role except manufacturer_rep. */
  yard_id?: string;
  /** Required for manufacturer_rep: the manufacturer the account belongs to. */
  manufacturer_id?: string;
  /** Required when role is "line_rep": the shipping line code the rep is scoped to. */
  shipping_line?: string;
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
    const manufacturer_id = body.manufacturer_id;
    const shipping_line = (body.shipping_line || "").trim();

    const isRep = role === "manufacturer_rep";
    if (!username || !password || !fullName || !role) {
      return json({ error: "Missing fields" }, 400);
    }
    // A manufacturer's login has a manufacturer and no yard; everyone else has a yard.
    if (isRep ? !manufacturer_id || yard_id : !yard_id || manufacturer_id) {
      return json(
        { error: isRep ? "A manufacturer account needs a manufacturer and no yard" : "A yard is required (and no manufacturer)" },
        400,
      );
    }
    if (!/^[a-z0-9_]+$/.test(username) || username.length < 3) {
      return json({ error: "Invalid username" }, 400);
    }
    if (password.length < 10) return json({ error: "Password must be at least 10 characters" }, 400);
    if (!["admin", "user", "inspector", "line_rep", "read_only_admin", "manufacturer_rep"].includes(role)) {
      return json({ error: "Invalid role" }, 400);
    }
    if (role === "line_rep") {
      if (!shipping_line || !/^[A-Za-z0-9]{2,10}$/.test(shipping_line)) {
        return json({ error: "A valid shipping line code is required for a line representative" }, 400);
      }
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    // Authorization: super_admin can create any role; yard admins can create
    // 'user' or 'inspector' in their own yard. Admins, read-only admins and
    // manufacturer accounts are super-admin only.
    const access = await callerAccess(admin, caller.id);
    if ("error" in access) {
      console.error("Caller role lookup failed:", access.error);
      return json(
        { error: `Authorization check failed: ${access.error.message}` },
        500,
      );
    }
    if (!access.roles.includes("super_admin")) {
      if (role === "admin" || role === "read_only_admin") {
        return json({ error: "Only super-admins can create admins" }, 403);
      }
      if (role === "manufacturer_rep") {
        return json({ error: "Only super-admins can create manufacturer accounts" }, 403);
      }
      if (!access.roles.includes("admin") || access.yardId !== yard_id) {
        return json({ error: "Not a yard admin for this yard" }, 403);
      }
    }

    // A read-only admin only makes sense in a car-lot yard: container tables
    // give that role nothing to read, so the account would see an empty app.
    if (role === "read_only_admin") {
      const { data: yardRow, error: yardErr } = await admin
        .from("yards").select("kind").eq("id", yard_id!).maybeSingle();
      if (yardErr) return json({ error: `Yard check failed: ${yardErr.message}` }, 500);
      if (!yardRow) return json({ error: "Unknown yard" }, 400);
      if (yardRow.kind !== "vehicle") {
        return json({ error: "A read-only admin can only be created for a car-lot yard" }, 400);
      }
    }
    if (isRep) {
      const { data: mfr, error: mfrErr } = await admin
        .from("manufacturers").select("id, active").eq("id", manufacturer_id!).maybeSingle();
      if (mfrErr) return json({ error: `Manufacturer check failed: ${mfrErr.message}` }, 500);
      if (!mfr) return json({ error: "Unknown manufacturer" }, 400);
      if (!mfr.active) return json({ error: "That manufacturer is not active" }, 400);
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

    // Store the line exactly as shipping_lines spells it. Scoping compares
    // profiles.shipping_line to the code on containers, port data and payments,
    // so a rep saved as '7SEAS' against containers marked '7Seas' would see an
    // empty yard.
    let repLine = shipping_line;
    if (role === "line_rep") {
      const { data: lineRow, error: lineErr } = await admin
        .from("shipping_lines")
        .select("code")
        .ilike("code", shipping_line)
        .maybeSingle();
      if (lineErr) {
        console.error("Shipping line lookup failed:", lineErr);
        return json({ error: `Shipping line check failed: ${lineErr.message}` }, 500);
      }
      if (!lineRow) {
        return json({ error: `Unknown shipping line "${shipping_line}"` }, 400);
      }
      repLine = lineRow.code;
    }

    // Role, yard and line go in app_metadata (service role only); see
    // metadata.ts. handle_new_user turns them into the profile and role row.
    const email = `${username}@containeryard.app`;
    const { data: created, error: createErr } = await admin.auth.admin
      .createUser({
        email,
        password,
        email_confirm: true,
        ...newUserMetadata({ fullName, username, role, yard_id, shipping_line: repLine }),
      });
    if (createErr) {
      console.error("createUser failed:", createErr);
      return json({ error: createErr.message }, 400);
    }

    // handle_new_user cannot know the manufacturer, so link it now with the
    // service role (the profiles guard only lets a super admin or the service
    // role change manufacturer_id). If that fails, remove the half-made
    // account so the username is not left taken by an account with no access.
    if (isRep && created.user) {
      const { error: linkErr } = await admin
        .from("profiles")
        .update({ manufacturer_id })
        .eq("user_id", created.user.id);
      if (linkErr) {
        console.error("Linking manufacturer failed:", linkErr);
        await admin.auth.admin.deleteUser(created.user.id);
        return json({ error: `Could not link the manufacturer: ${linkErr.message}` }, 500);
      }
    }

    return json({ ok: true, user_id: created.user?.id });
  } catch (e) {
    console.error("create-user unexpected error:", e);
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});

// The caller's roles and yard. Mirrors the database's is_super_admin /
// is_yard_admin (a yard admin holds the 'admin' role and has that yard on
// their profile), which live in a schema the API doesn't expose.
async function callerAccess(
  admin: SupabaseClient,
  userId: string,
): Promise<{ roles: string[]; yardId: string | null } | { error: { message: string } }> {
  const [rolesRes, profileRes] = await Promise.all([
    admin.from("user_roles").select("role").eq("user_id", userId),
    admin.from("profiles").select("yard_id").eq("user_id", userId).maybeSingle(),
  ]);
  const error = rolesRes.error ?? profileRes.error;
  if (error) return { error };
  return {
    roles: (rolesRes.data ?? []).map((r: { role: string }) => r.role),
    yardId: (profileRes.data as { yard_id: string | null } | null)?.yard_id ?? null,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
