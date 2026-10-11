import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Payload {
  /** The user whose password is being reset. */
  user_id: string;
  password: string;
}

/** Roles a yard admin may reset. Admins and super-admins are off limits. */
const YARD_ADMIN_RESETTABLE = ["user", "inspector", "line_rep"];

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
    const user_id = (body.user_id || "").trim();
    const password = body.password || "";

    if (!user_id || !password) return json({ error: "Missing fields" }, 400);
    if (password.length < 10) {
      return json({ error: "Password must be at least 10 characters" }, 400);
    }
    // Changing your own password goes through the account page, which verifies
    // the current password first. Don't offer a way around that check here.
    if (user_id === caller.id) {
      return json(
        { error: "Use the account page to change your own password" },
        400,
      );
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE);

    const { data: target, error: targetErr } = await admin
      .from("profiles")
      .select("yard_id")
      .eq("user_id", user_id)
      .maybeSingle();
    if (targetErr) {
      console.error("Target profile lookup failed:", targetErr);
      return json({ error: `Lookup failed: ${targetErr.message}` }, 500);
    }
    if (!target) return json({ error: "User not found" }, 404);

    const { data: targetRoles, error: rolesErr } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user_id);
    if (rolesErr) {
      console.error("Target role lookup failed:", rolesErr);
      return json({ error: `Lookup failed: ${rolesErr.message}` }, 500);
    }
    const roles = (targetRoles ?? []).map((r: { role: string }) => r.role);

    // Authorization: super-admins may reset anyone; yard admins only the
    // non-admin accounts of their own yard.
    const access = await callerAccess(admin, caller.id);
    if ("error" in access) {
      console.error("Caller role lookup failed:", access.error);
      return json(
        { error: `Authorization check failed: ${access.error.message}` },
        500,
      );
    }
    if (!access.roles.includes("super_admin")) {
      if (!target.yard_id) {
        return json({ error: "Not a yard admin for this user's yard" }, 403);
      }
      if (!access.roles.includes("admin") || access.yardId !== target.yard_id) {
        return json({ error: "Not a yard admin for this user's yard" }, 403);
      }
      if (!roles.every((role) => YARD_ADMIN_RESETTABLE.includes(role))) {
        return json(
          { error: "Only super-admins can reset an admin's password" },
          403,
        );
      }
    }

    const { error: updateErr } = await admin.auth.admin.updateUserById(
      user_id,
      { password },
    );
    if (updateErr) {
      console.error("updateUserById failed:", updateErr);
      return json({ error: updateErr.message }, 400);
    }

    return json({ ok: true });
  } catch (e) {
    console.error("reset-user-password unexpected error:", e);
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
