// backfill-v3-event-details
// ---------------------------------------------------------------------------
// ONE-OFF utility. Re-fetches the Intercom conversation payload (at API
// version 2.13, which returns `event_details` on conversation parts) for
// already-finalized v3 tickets created on/after 2026-07-15, and refreshes ONLY
// `raw_payload` + `last_synced_at`.
//
// Deliberately does NOT touch lifecycle_status, reopen counters/baselines,
// custom_attributes, the v3_ticket_attributes EAV mirror, customer_* fields,
// or anything else. This is a payload refresh, not a re-finalize.
//
// Idempotent: a re-run simply re-fetches. Time-boxed; stops cleanly.
// ---------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import { V3_CORS_HEADERS, intercomHeaders } from "../_shared/v3.ts";
import { requireEditor } from "../_shared/require-editor.ts";

const TIME_BUDGET_MS = 110_000;
const SINCE_ISO = "2026-07-15T00:00:00Z";
const PACE_MS = 220;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: V3_CORS_HEADERS });

  const gate = await requireEditor(req, V3_CORS_HEADERS);
  if (!gate.ok) return gate.response;

  const startedAt = Date.now();
  const token = Deno.env.get("INTERCOM_API_TOKEN");
  if (!token) return json({ ok: false, error: "INTERCOM_API_TOKEN not configured" }, 500);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: targets, error } = await supabase
    .from("intercom_tickets_v3")
    .select("id, intercom_conversation_id")
    .in("lifecycle_status", ["finalized", "reopened_after_finalize"])
    .gte("intercom_created_at", SINCE_ISO)
    .order("intercom_created_at", { ascending: true });

  if (error) return json({ ok: false, error: error.message }, 500);

  let attempted = 0, updated = 0, getFailed = 0;
  const failedSamples: Array<{ conv_id: string; status: number | string }> = [];
  let timedOut = false;

  for (const t of targets ?? []) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) { timedOut = true; break; }
    attempted++;

    const convId = t.intercom_conversation_id;
    let payload: any = null;
    let lastStatus: number | string = "unknown";

    for (let tryN = 0; tryN < 2; tryN++) {
      try {
        const res = await fetch(`https://api.intercom.io/conversations/${convId}`, {
          headers: intercomHeaders(token),
        });
        lastStatus = res.status;
        if (res.status === 429) { await sleep(2000); continue; }
        if (!res.ok) break;
        payload = await res.json();
        break;
      } catch (e) {
        lastStatus = (e as Error).message;
      }
    }

    if (!payload) {
      getFailed++;
      if (failedSamples.length < 5) failedSamples.push({ conv_id: convId, status: lastStatus });
      await sleep(PACE_MS);
      continue;
    }

    const { error: updErr } = await supabase
      .from("intercom_tickets_v3")
      .update({ raw_payload: payload, last_synced_at: new Date().toISOString() })
      .eq("id", t.id);

    if (updErr) {
      getFailed++;
      if (failedSamples.length < 5) failedSamples.push({ conv_id: convId, status: `db: ${updErr.message}` });
    } else {
      updated++;
    }

    await sleep(PACE_MS);
  }

  return json({
    ok: true,
    target_total: targets?.length ?? 0,
    attempted,
    updated,
    get_failed: getFailed,
    failed_samples: failedSamples,
    timed_out: timedOut,
    duration_ms: Date.now() - startedAt,
  });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...V3_CORS_HEADERS, "Content-Type": "application/json" },
  });
}
