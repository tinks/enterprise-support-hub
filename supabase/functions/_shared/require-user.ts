import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Validates that the caller presented a real Supabase user session JWT.
 *
 * NOTE: this helper is for functions invoked ONLY from the signed-in UI.
 * Do NOT use it on functions triggered by pg_cron / webhooks — those carry the
 * anon key (or a Slack/Intercom signature), not a user JWT, and would 401.
 *
 * Returns `{ ok: true, userId }` or `{ ok: false, response }` (a 401 to return).
 */
export async function requireUser(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<
  | { ok: true; userId: string; token: string }
  | { ok: false; response: Response }
> {
  const unauthorized = (message: string) => ({
    ok: false as const,
    response: new Response(JSON.stringify({ error: message }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    }),
  });

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return unauthorized("Authentication required");
  }

  const token = authHeader.slice("Bearer ".length).trim();
  if (!token) return unauthorized("Authentication required");

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    return {
      ok: false,
      response: new Response(
        JSON.stringify({ error: "Auth not configured" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      ),
    };
  }

  // The anon key itself is a valid JWT but carries no `sub` — getClaims rejects
  // it as a user session, which is exactly what we want here.
  const client = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data, error } = await client.auth.getClaims(token);
  const sub = data?.claims?.sub as string | undefined;
  if (error || !sub) {
    return unauthorized("Invalid or expired session");
  }

  return { ok: true, userId: sub, token };
}
