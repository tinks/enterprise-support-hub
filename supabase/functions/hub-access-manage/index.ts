import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser } from "../_shared/require-user.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

/**
 * Admin-only access management for the Hub member roster.
 *
 * Actions:
 *  - provision   : create the backend account for a `pending` roster row so the
 *                  person can sign in with their Lovable workspace identity.
 *  - block       : delete the backend account and mark the row `blocked`.
 *                  Self-signup is closed, so a blocked person cannot return.
 *  - unblock     : return a blocked row to `pending` (re-provision to restore).
 *
 * Every call requires a real user session AND the `admin` role. Nothing here is
 * reachable by cron or the anon key.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const auth = await requireUser(req, corsHeaders);
  if (!auth.ok) return auth.response;

  const url = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Role check — service role client, but gated on the *caller's* uid.
  const { data: isAdmin, error: roleErr } = await admin.rpc("has_role", {
    _user_id: auth.userId,
    _role: "admin",
  });
  if (roleErr) return json({ error: `Role check failed: ${roleErr.message}` }, 500);
  if (!isAdmin) return json({ error: "Admin role required" }, 403);

  let body: { action?: string; email?: string; note?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON body required" }, 400);
  }

  const action = body.action;
  const email = (body.email ?? "").trim().toLowerCase();
  if (!action) return json({ error: "action required" }, 400);
  if (!email) return json({ error: "email required" }, 400);
  if (email.split("@")[1] !== "lovable.dev") {
    return json({ error: "Only @lovable.dev addresses can be granted Hub access" }, 400);
  }

  const { data: row, error: rowErr } = await admin
    .from("hub_members")
    .select("*")
    .eq("email", email)
    .maybeSingle();
  if (rowErr) return json({ error: rowErr.message }, 500);
  if (!row) return json({ error: `No roster row for ${email}` }, 404);

  // Find any existing auth account for this address.
  const findUser = async (): Promise<{ id: string } | null> => {
    let page = 1;
    for (;;) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
      if (error) throw new Error(error.message);
      const hit = data.users.find((u) => (u.email ?? "").toLowerCase() === email);
      if (hit) return { id: hit.id };
      if (data.users.length < 200) return null;
      page++;
    }
  };

  try {
    if (action === "provision") {
      if (row.status === "blocked") {
        return json({ error: "Row is blocked — unblock it first" }, 409);
      }
      let existing = await findUser();
      if (existing && row.status === "active" && row.user_id === existing.id) {
        return json({ error: "Already provisioned" }, 409);
      }
      if (!existing) {
        const { data, error } = await admin.auth.admin.createUser({
          email,
          email_confirm: true,
          password: crypto.randomUUID() + crypto.randomUUID(),
        });
        if (error) return json({ error: `Create failed: ${error.message}` }, 500);
        existing = { id: data.user!.id };
      }
      const { error: upErr } = await admin
        .from("hub_members")
        .update({
          user_id: existing.id,
          status: "active",
          provisioned_at: new Date().toISOString(),
          first_seen_at: row.first_seen_at ?? null,
        })
        .eq("id", row.id);
      if (upErr) return json({ error: upErr.message }, 500);
      return json({ ok: true, action, email, user_id: existing.id });
    }

    if (action === "block") {
      const existing = await findUser();
      if (existing) {
        // Never strand the project without an admin.
        const { data: admins, error: adminsErr } = await admin
          .from("user_roles")
          .select("user_id")
          .eq("role", "admin");
        if (adminsErr) return json({ error: adminsErr.message }, 500);
        const isTargetAdmin = (admins ?? []).some((a) => a.user_id === existing.id);
        if (isTargetAdmin && (admins ?? []).length <= 1) {
          return json({ error: "Cannot block the last remaining admin" }, 409);
        }
        if (existing.id === auth.userId) {
          return json({ error: "You cannot block your own account" }, 409);
        }
        const { error: delErr } = await admin.auth.admin.deleteUser(existing.id);
        if (delErr) return json({ error: `Delete failed: ${delErr.message}` }, 500);
      }
      const { error: upErr } = await admin
        .from("hub_members")
        .update({
          status: "blocked",
          user_id: null,
          blocked_at: new Date().toISOString(),
          blocked_by: auth.userId,
        })
        .eq("id", row.id);
      if (upErr) return json({ error: upErr.message }, 500);
      return json({ ok: true, action, email, account_deleted: !!existing });
    }

    if (action === "unblock") {
      if (row.status !== "blocked") return json({ error: "Row is not blocked" }, 409);
      const { error: upErr } = await admin
        .from("hub_members")
        .update({ status: "pending", blocked_at: null, blocked_by: null })
        .eq("id", row.id);
      if (upErr) return json({ error: upErr.message }, 500);
      return json({ ok: true, action, email });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
