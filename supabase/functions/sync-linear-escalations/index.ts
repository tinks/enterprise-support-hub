// sync-linear-escalations — pulls Linear issue title / state / assignee onto the
// Hub's dev escalations board.
//
// Read-only against Linear. Writes ONLY the linear_* mirror columns on
// public.dev_escalations; hub_state, note, owner and linear_url_override are
// human-owned and never touched here.
//
// Key resolution mirrors the Escalations page: Hub override first, then the
// Intercom custom attributes "Linear Issue" / "Escalated Issue".
//
// Rows are created for tickets that carry a Linear reference but have no Hub row
// yet (hub_state defaults to 'open'), so the board shows live Linear metadata
// without anyone having to touch the row first.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  classifyHttpStatus,
  recordIntegrationHealth,
} from "../_shared/integration-health.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const GATEWAY_URL = "https://connector-gateway.lovable.dev/linear";
const INTEGRATION = "linear_escalation_sync";
const MAX_KEYS = 200; // hard cap so one bad run can never fan out unbounded

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

/** Extract a Linear issue key (e.g. ENT-3054) from a URL or a bare reference. */
function extractKey(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const fromUrl = s.match(/linear\.app\/[^/\s]+\/issue\/([A-Z][A-Z0-9]*-\d+)/i);
  if (fromUrl) return fromUrl[1].toUpperCase();
  const bare = s.match(/\b([A-Z][A-Z0-9]*-\d+)\b/i);
  if (bare) return bare[1].toUpperCase();
  return null;
}

const ISSUE_QUERY = `query($team:String!,$num:Float!){
  issues(filter:{team:{key:{eq:$team}}, number:{eq:$num}}, first:1){
    nodes{
      identifier title url state{name type} assignee{name}
      createdAt startedAt completedAt canceledAt
    }
  }
}`;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const lovableKey = Deno.env.get("LOVABLE_API_KEY");
  const linearKey = Deno.env.get("LINEAR_API_KEY");
  if (!lovableKey || !linearKey) {
    return json({ error: "Linear connector credentials are not configured" }, 500);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // 1. Collect candidate (conversation id -> Linear key) pairs.
  const [tickets, escalations] = await Promise.all([
    supabase
      .from("intercom_tickets_v3")
      .select("intercom_conversation_id, custom_attributes, lifecycle_status, customer_resolution_method")
      .limit(3000),
    supabase.from("dev_escalations").select("intercom_conversation_id, linear_url_override, linear_key"),
  ]);

  if (tickets.error) return json({ error: tickets.error.message }, 500);
  if (escalations.error) return json({ error: escalations.error.message }, 500);

  const overrides = new Map<string, string | null>();
  for (const r of escalations.data ?? []) {
    overrides.set(r.intercom_conversation_id, r.linear_url_override);
  }

  const pairs: Array<{ conversationId: string; key: string }> = [];
  for (const t of tickets.data ?? []) {
    if (t.lifecycle_status === "transferred_out") continue;
    if (t.customer_resolution_method === "not_enterprise") continue;
    const attrs = (t.custom_attributes ?? {}) as Record<string, unknown>;
    const key =
      extractKey(overrides.get(t.intercom_conversation_id) as string | null) ??
      extractKey(attrs["Linear Issue"] as string | null) ??
      extractKey(attrs["Escalated Issue"] as string | null);
    if (key) pairs.push({ conversationId: t.intercom_conversation_id, key });
  }
  // Escalation rows whose only reference is the Hub override (ticket may be older
  // than the 3000-row window above).
  for (const r of escalations.data ?? []) {
    if (pairs.some((p) => p.conversationId === r.intercom_conversation_id)) continue;
    const key = extractKey(r.linear_url_override);
    if (key) pairs.push({ conversationId: r.intercom_conversation_id, key });
  }

  const capped = pairs.slice(0, MAX_KEYS);
  const uniqueKeys = Array.from(new Set(capped.map((p) => p.key)));

  // 2. Fetch each distinct key from Linear once.
  const found = new Map<string, {
    title: string;
    state: string;
    stateType: string | null;
    assignee: string | null;
    createdAt: string | null;
    startedAt: string | null;
    completedAt: string | null;
    canceledAt: string | null;
  }>();
  const notFound: string[] = [];
  let gatewayError: string | null = null;

  for (const key of uniqueKeys) {
    const m = key.match(/^([A-Z][A-Z0-9]*)-(\d+)$/);
    if (!m) { notFound.push(key); continue; }

    let res: Response;
    let text = "";
    try {
      res = await fetch(`${GATEWAY_URL}/graphql`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "X-Connection-Api-Key": linearKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: ISSUE_QUERY, variables: { team: m[1], num: Number(m[2]) } }),
      });
      text = await res.text();
    } catch (e) {
      gatewayError = e instanceof Error ? e.message : String(e);
      break;
    }

    if (!res.ok) {
      // Surface the gateway/provider status and body verbatim, and stop: a bad
      // token or rate limit would otherwise look like "issues not found".
      gatewayError = `HTTP ${res.status}: ${text.slice(0, 300)}`;
      await recordIntegrationHealth(supabase, INTEGRATION, classifyHttpStatus(res.status), gatewayError);
      return json({ error: "Linear request failed", status: res.status, details: text.slice(0, 500) }, res.status);
    }

    let payload: any = {};
    try { payload = JSON.parse(text); } catch { gatewayError = "unparseable response"; break; }
    if (payload.errors?.length) { gatewayError = JSON.stringify(payload.errors).slice(0, 300); break; }

    const node = payload?.data?.issues?.nodes?.[0];
    if (!node) { notFound.push(key); continue; }
    found.set(key, {
      title: node.title ?? "",
      state: node.state?.name ?? "",
      stateType: node.state?.type ?? null,
      assignee: node.assignee?.name ?? null,
      createdAt: node.createdAt ?? null,
      startedAt: node.startedAt ?? null,
      completedAt: node.completedAt ?? null,
      canceledAt: node.canceledAt ?? null,
    });
  }

  if (gatewayError) {
    await recordIntegrationHealth(supabase, INTEGRATION, "error", gatewayError);
    return json({ error: gatewayError, resolved: found.size }, 502);
  }

  // 3. Mirror onto dev_escalations. Only the linear_* columns are written.
  const nowIso = new Date().toISOString();
  const rows = capped
    .filter((p) => found.has(p.key))
    .map((p) => {
      const issue = found.get(p.key)!;
      return {
        intercom_conversation_id: p.conversationId,
        linear_key: p.key,
        linear_title: issue.title,
        linear_state: issue.state,
        linear_assignee: issue.assignee,
        linear_state_type: issue.stateType,
        // Timestamps feed the engineering-wait clock (Engine v3).
        linear_created_at: issue.createdAt,
        linear_started_at: issue.startedAt,
        linear_completed_at: issue.completedAt,
        linear_canceled_at: issue.canceledAt,
        linear_synced_at: nowIso,
      };
    });

  let written = 0;
  if (rows.length > 0) {
    const { error, count } = await supabase
      .from("dev_escalations")
      .upsert(rows, { onConflict: "intercom_conversation_id", count: "exact" });
    if (error) {
      await recordIntegrationHealth(supabase, INTEGRATION, "error", error.message);
      return json({ error: error.message }, 500);
    }
    written = count ?? rows.length;
  }

  await recordIntegrationHealth(
    supabase,
    INTEGRATION,
    "ok",
    notFound.length > 0 ? `Keys not found in Linear: ${notFound.slice(0, 20).join(", ")}` : null,
  );

  return json({
    ok: true,
    synced_at: nowIso,
    candidates: pairs.length,
    considered: capped.length,
    distinct_keys: uniqueKeys.length,
    resolved: found.size,
    not_found: notFound,
    rows_written: written,
    capped: pairs.length > MAX_KEYS,
  });
});
