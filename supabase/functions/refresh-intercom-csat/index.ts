import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { recordIntegrationHealth, classifyHttpStatus } from "../_shared/integration-health.ts";
import { requireEditorOrSecret } from "../_shared/require-editor-or-secret.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const toIso = (ts: number) => new Date(ts * 1000).toISOString();

async function fetchIntercomConv(id: string, token: string) {
  const res = await fetch(`https://api.intercom.io/conversations/${id}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Intercom-Version": "2.13",
    },
  });
  if (!res.ok) {
    return { ok: false as const, status: res.status };
  }
  return { ok: true as const, data: await res.json() };
}

interface Row { id: string; intercom_conversation_id: string }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const gate = await requireEditorOrSecret(req, corsHeaders);
  if (!gate.ok) return gate.response;

  const INTERCOM_API_TOKEN = Deno.env.get("INTERCOM_API_TOKEN");
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!INTERCOM_API_TOKEN) {
    return new Response(JSON.stringify({ error: "INTERCOM_API_TOKEN not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") || "recent"; // "recent" | "backfill"
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "200", 10), 1000);
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  // Recent mode: only conversations resolved in last 14 days that don't yet have a rating
  // Backfill mode: every Intercom-linked row without a rating
  const cutoffIso = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

  let manualQ = sb.from("manual_conversations")
    .select("id, intercom_conversation_id")
    .not("intercom_conversation_id", "is", null)
    .is("csat_rating", null)
    .limit(limit);
  let gmailQ = sb.from("gmail_conversations")
    .select("id, intercom_conversation_id")
    .not("intercom_conversation_id", "is", null)
    .is("csat_rating", null)
    .limit(limit);
  if (mode === "recent") {
    manualQ = manualQ.gte("resolved_at", cutoffIso);
    gmailQ = gmailQ.gte("resolved_at", cutoffIso);
  }

  const [{ data: manualRows = [] }, { data: gmailRows = [] }] = await Promise.all([manualQ, gmailQ]);

  const targets: Array<{ table: "manual_conversations" | "gmail_conversations"; row: Row }> = [
    ...(manualRows as Row[]).map(r => ({ table: "manual_conversations" as const, row: r })),
    ...(gmailRows as Row[]).map(r => ({ table: "gmail_conversations" as const, row: r })),
  ];

  let updated = 0;
  let checked = 0;
  let errors = 0;

  let lastErrorStatus = 0;
  for (const t of targets) {
    checked++;
    try {
      const res = await fetchIntercomConv(t.row.intercom_conversation_id, INTERCOM_API_TOKEN);
      if (!res.ok) { errors++; lastErrorStatus = res.status; await new Promise(r => setTimeout(r, 200)); continue; }
      const rating = res.data?.conversation_rating;
      if (!rating || typeof rating.rating !== "number") {
        await new Promise(r => setTimeout(r, 200));
        continue;
      }
      const { error: updErr } = await sb.from(t.table).update({
        csat_rating: rating.rating,
        csat_remark: rating.remark || null,
        csat_rated_at: rating.created_at ? toIso(rating.created_at) : null,
      }).eq("id", t.row.id);
      if (updErr) { errors++; console.error(`update ${t.table} ${t.row.id} failed`, updErr); }
      else { updated++; }
    } catch (e) {
      errors++;
      console.error("loop error", e);
    }
    // ~5 req/sec
    await new Promise(r => setTimeout(r, 200));
  }

  // Record health: auth_error if every fetch returned 401/403; ok if anything succeeded; error otherwise
  if (checked > 0) {
    if (errors === checked && (lastErrorStatus === 401 || lastErrorStatus === 403)) {
      await recordIntegrationHealth(sb, "intercom_csat", "auth_error", `Intercom ${lastErrorStatus}`);
    } else if (errors === checked) {
      await recordIntegrationHealth(sb, "intercom_csat", "error", `all ${checked} fetches failed (last status ${lastErrorStatus})`);
    } else {
      await recordIntegrationHealth(sb, "intercom_csat", "ok");
    }
  } else {
    await recordIntegrationHealth(sb, "intercom_csat", "ok");
  }

  return new Response(JSON.stringify({ mode, checked, updated, errors }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});

