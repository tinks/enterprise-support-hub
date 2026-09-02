// reconcile-v3-open
// ---------------------------------------------------------------------------
// Reconciles our believed-open v3 tickets against the CURRENT Enterprise Inbox.
// Tickets we think are open but that are no longer in the inbox are re-checked
// one-by-one via GET /conversations/{id} (the authoritative check) and resolved:
//   - different team  -> lifecycle_status = 'transferred_out'
//   - closed/resolved -> finalizeConversation() catch-up
//   - still ours+open -> skipped (pagination / snooze edge)
//
// Safety: if the truth-set search errors, we abort WITHOUT writing anything.
// ---------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  intercomHeaders,
  isFinalizedTicketState,
  isTicketPayload,
  TIME_BUDGET_MS,
  V3_CORS_HEADERS,
} from "../_shared/v3.ts";
import { finalizeConversation } from "../_shared/v3-finalize.ts";
import { resolveInboxes, inboxSearchClause } from "../_shared/v3-inboxes.ts";
import {
import { requireEditorOrSecret } from "../_shared/require-editor-or-secret.ts";
  type IntegrationKey,
  recordIntegrationHealth,
} from "../_shared/integration-health.ts";

const HEALTH_KEY: IntegrationKey = "reconcile-v3-open";

async function health(sb: any, status: "ok" | "error", detail?: string) {
  try {
    await recordIntegrationHealth(sb, HEALTH_KEY, status, detail ?? null);
  } catch (e) {
    console.error("[reconcile-v3-open] health write failed", e);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: V3_CORS_HEADERS });

  const gate = await requireEditorOrSecret(req, V3_CORS_HEADERS);
  if (!gate.ok) return gate.response;

  const startedAt = Date.now();
  const INTERCOM_API_TOKEN = Deno.env.get("INTERCOM_API_TOKEN");
  if (!INTERCOM_API_TOKEN) return json({ error: "INTERCOM_API_TOKEN not configured" }, 500);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: settings } = await supabase.from("settings").select("*").limit(1).single();
  if (!settings?.intercom_inbox_id) return json({ error: "No enterprise inbox configured" }, 400);
  const inboxes = resolveInboxes(settings);

  let adminOwnerMap: Record<string, string> = {};
  try { adminOwnerMap = JSON.parse(settings.admin_owner_map || "{}"); } catch { /* ignore */ }

  // ---- 1. Truth set: every conversation currently open/snoozed in our inbox ----
  const truthOpenIds = new Set<string>();
  let startingAfter: string | null = null;
  let page = 0;
  const MAX_PAGES = 60;

  while (page < MAX_PAGES) {
    if (Date.now() - startedAt > TIME_BUDGET_MS * 0.4) {
      console.warn("[reconcile-v3-open] truth-set time budget hit at page " + page);
      break;
    }

    const reqBody: any = {
      query: {
        operator: "AND",
        value: [
          inboxSearchClause(inboxes.ids),
          {
            operator: "OR",
            value: [
              { field: "state", operator: "=", value: "open" },
              { field: "state", operator: "=", value: "snoozed" },
            ],
          },
        ],
      },
      pagination: startingAfter
        ? { per_page: 150, starting_after: startingAfter }
        : { per_page: 150 },
    };

    const res = await fetch("https://api.intercom.io/conversations/search", {
      method: "POST",
      headers: intercomHeaders(INTERCOM_API_TOKEN),
      body: JSON.stringify(reqBody),
    });
    if (!res.ok) {
      const text = await res.text();
      console.error(`[reconcile-v3-open] truth-set search failed ${res.status}: ${text.slice(0, 300)}`);
      await health(supabase, "error", `truth-set search failed ${res.status}: ${text.slice(0, 200)}`);
      // CRITICAL GUARD: never mark anything off a failed truth set.
      return json({
        ok: false,
        error: "Intercom truth-set search failed — aborted without marking anything",
        status: res.status,
        details: text.slice(0, 300),
      }, 502);
    }

    const data = await res.json();
    const list = data.conversations || data.data || [];
    for (const c of list) truthOpenIds.add(String(c.id));

    page++;
    const next = data.pages?.next?.starting_after;
    if (!next) break;
    startingAfter = next;
  }

  // ---- 2. Believed-open rows in our store ----
  const { data: believed, error: believedErr } = await supabase
    .from("intercom_tickets_v3")
    .select("id, intercom_conversation_id, intercom_created_at")
    .in("lifecycle_status", ["open", "reopened_after_finalize"]);
  if (believedErr) {
    return json({ ok: false, error: `believed-open query failed: ${believedErr.message}` }, 500);
  }

  const believedRows = believed || [];
  const departed = believedRows.filter(
    (r) => !truthOpenIds.has(String(r.intercom_conversation_id)),
  );

  // ---- 3. Per-ticket authoritative re-check ----
  let transferred_out = 0;
  let finalized_catchup = 0;
  let get_failed = 0;
  let update_failed = 0;
  let finalize_skipped = 0;
  let still_open_edge = 0;
  const samples: any[] = [];
  const pushSample = (s: any) => { if (samples.length < 12) samples.push(s); };

  for (const row of departed) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      console.warn("[reconcile-v3-open] per-ticket time budget hit");
      break;
    }

    const convId = String(row.intercom_conversation_id);
    let icData: any;
    try {
      const res = await fetch(`https://api.intercom.io/conversations/${convId}`, {
        headers: intercomHeaders(INTERCOM_API_TOKEN),
      });
      if (!res.ok) {
        const body = await res.text();
        console.warn(`[reconcile-v3-open] GET ${convId} -> ${res.status}: ${body.slice(0, 200)}`);
        get_failed++;
        pushSample({ convId, outcome: "get_failed", getStatus: res.status, error: body.slice(0, 200) });
        continue;
      }
      icData = await res.json();
    } catch (e) {
      console.warn(`[reconcile-v3-open] GET ${convId} threw: ${(e as Error).message}`);
      get_failed++;
      pushSample({ convId, outcome: "get_failed", getStatus: null, error: (e as Error).message });
      continue;
    }

    const curTeam = String(icData.team_assignee_id || "");
    const curState = String(icData.state || "");

    if (!inboxes.isOurs(curTeam)) {
      const { error: upErr } = await supabase
        .from("intercom_tickets_v3")
        .update({
          lifecycle_status: "transferred_out",
          transferred_at: new Date().toISOString(),
          reassigned_team_id: curTeam || null,
          last_synced_at: new Date().toISOString(),
        })
        .eq("id", row.id);
      if (upErr) {
        console.error(`[reconcile-v3-open] transfer update failed conv=${convId}: ${upErr.message}`);
        update_failed++;
        pushSample({ convId, outcome: "update_failed", curTeam, curState, updateError: upErr.message });
      } else {
        transferred_out++;
        pushSample({ convId, outcome: "transferred_out", curTeam, curState });
      }
      continue;
    }

    if (curState === "closed" || (isTicketPayload(icData) && isFinalizedTicketState(icData))) {
      const r = await finalizeConversation({
        supabase,
        intercomToken: INTERCOM_API_TOKEN,
        convId,
        inboxes,
        adminOwnerMap,
        existing: { id: row.id },
      });
      if (r.kind === "inserted" || r.kind === "updated") {
        finalized_catchup++;
        pushSample({ convId, outcome: "finalized", curTeam, curState });
      } else {
        console.warn(`[reconcile-v3-open] finalize ${convId} -> ${r.kind}: ${(r as any).reason ?? ""}`);
        finalize_skipped++;
        pushSample({ convId, outcome: "finalize_skipped", curTeam, curState, reason: (r as any).reason ?? r.kind });
      }
      continue;
    }

    // Still open and still in our inbox — pagination/snooze edge. Leave alone.
    still_open_edge++;
    pushSample({ convId, outcome: "still_open_edge", curTeam, curState });
  }

  await health(
    supabase,
    "ok",
    `departed=${departed.length} transferred_out=${transferred_out} finalized=${finalized_catchup} get_failed=${get_failed} update_failed=${update_failed}`,
  );

  return json({
    ok: true,
    believed_open: believedRows.length,
    truth_open: truthOpenIds.size,
    departed: departed.length,
    transferred_out,
    finalized_catchup,
    skipped: get_failed + update_failed + finalize_skipped + still_open_edge,
    get_failed,
    update_failed,
    finalize_skipped,
    still_open_edge,
    samples,
    elapsed_ms: Date.now() - startedAt,

  });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...V3_CORS_HEADERS, "Content-Type": "application/json" },
  });
}
