import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireUser } from "./require-user.ts";

/**
 * Validates that the caller has a real user session AND write permission
 * (`editor` or `admin` in public.user_roles) — the same rule the RLS policies
 * enforce via public.can_edit().
 *
 * Read-only accounts (no role row) get a 403. Like requireUser, this helper is
 * ONLY for functions invoked from the signed-in UI — never for pg_cron or
 * webhook-triggered functions, which carry no user JWT.
 *
 * Returns `{ ok: true, userId, token }` or `{ ok: false, response }`.
 */
export async function requireEditor(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<
  | { ok: true; userId: string; token: string }
  | { ok: false; response: Response }
> {
  const auth = await requireUser(req, corsHeaders);
  if (!auth.ok) return auth;

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Auth not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }),
    };
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await admin.rpc("can_edit", { _uid: auth.userId });

  if (error) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: `Permission check failed: ${error.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      ),
    };
  }

  if (!data) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "Read-only access — editor role required" }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      ),
    };
  }

  return auth;
}
