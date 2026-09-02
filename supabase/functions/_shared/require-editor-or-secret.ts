import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { requireEditor } from "./require-editor.ts";

/**
 * Gate for functions with MORE THAN ONE legitimate caller:
 *   1. pg_cron jobs        → `x-esh-cron-secret` header matching public.cron_auth.secret
 *   2. internal invokes    → Authorization: Bearer <service role key>
 *   3. the signed-in UI    → a user session with editor/admin (requireEditor)
 * Anything else gets 401/403.
 *
 * The cron secret lives in the database (public.cron_auth), so cron.schedule
 * commands can attach it via public.esh_cron_headers() without the value ever
 * being written into a job definition or shown in a UI.
 */

let cachedSecret: string | null = null;
let cachedAt = 0;
const SECRET_TTL_MS = 5 * 60 * 1000;

async function getCronSecret(): Promise<string | null> {
  if (cachedSecret && Date.now() - cachedAt < SECRET_TTL_MS) return cachedSecret;

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return null;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data, error } = await admin.from("cron_auth").select("secret").eq("id", true).maybeSingle();
  if (error || !data?.secret) return null;

  cachedSecret = data.secret as string;
  cachedAt = Date.now();
  return cachedSecret;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function requireEditorOrSecret(
  req: Request,
  corsHeaders: Record<string, string>,
): Promise<
  | { ok: true; caller: "cron" | "service" | "user"; userId?: string; token?: string }
  | { ok: false; response: Response }
> {
  // 1. cron shared secret
  const presented = req.headers.get("x-esh-cron-secret");
  if (presented) {
    const expected = await getCronSecret();
    if (expected && timingSafeEqual(presented, expected)) {
      return { ok: true, caller: "cron" };
    }
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Invalid cron secret" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }),
    };
  }

  // 2. internal service-role invocation (e.g. sync-v3-gap-scan → sync-v3-closed)
  const authHeader = req.headers.get("Authorization") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (serviceKey && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice("Bearer ".length).trim();
    if (timingSafeEqual(token, serviceKey)) {
      return { ok: true, caller: "service" };
    }
  }

  // 3. signed-in editor
  const gate = await requireEditor(req, corsHeaders);
  if (!gate.ok) return gate;
  return { ok: true, caller: "user", userId: gate.userId, token: gate.token };
}
