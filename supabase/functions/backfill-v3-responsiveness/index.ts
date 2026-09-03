// Backfill the persisted responsiveness metrics on intercom_tickets_v3:
// time to triage (Severity first set) and time to first HUMAN reply.
//
// Computes ENTIRELY from the stored `raw_payload` — no Intercom API calls.
// Re-runnable: rows already at RESPONSIVENESS_ENGINE_VERSION are skipped unless
// `force` is passed. Rows whose payload has no usable timeline are counted as
// `skipped_no_parts` and left NULL — never zeroed.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { computeResponsiveness, RESPONSIVENESS_ENGINE_VERSION } from "../_shared/sla-core.ts";
import { loadSupportRoster, registerConfiguredAnchors } from "../_shared/sla-roster.ts";
import { requireEditor } from "../_shared/require-editor.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const gate = await requireEditor(req, corsHeaders);
  if (!gate.ok) return gate.response;

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let body: any = {};
    try { body = await req.json(); } catch { /* defaults */ }
    const batch = Math.min(Math.max(Number(body?.batch ?? 200), 1), 500);
    const maxBatches = Math.min(Math.max(Number(body?.maxBatches ?? 10), 1), 50);
    const force = body?.force === true;

    await registerConfiguredAnchors(supabase);
    const roster = await loadSupportRoster(supabase);

    let processed = 0;
    let written = 0;
    let skippedNoParts = 0;
    let noTriage = 0;
    let noHumanReply = 0;
    let failed = 0;

    for (let b = 0; b < maxBatches; b++) {
      let q = supabase
        .from("intercom_tickets_v3")
        .select("id,intercom_conversation_id,raw_payload")
        .in("lifecycle_status", ["finalized", "reopened_after_finalize"])
        .order("intercom_created_at", { ascending: false })
        .limit(batch);
      if (!force) {
        q = q.or(
          `responsiveness_engine_version.is.null,responsiveness_engine_version.lt.${RESPONSIVENESS_ENGINE_VERSION}`,
        );
      }
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      const rows = data ?? [];
      if (rows.length === 0) break;

      for (const r of rows as Array<{ id: string; intercom_conversation_id: string; raw_payload: any }>) {
        processed++;
        try {
          const raw = r.raw_payload;
          const res = raw ? computeResponsiveness(raw, { roster }) : null;
          const usable = !!res && res.partsCount > 0;
          if (!usable) skippedNoParts++;
          else {
            if (res!.triageAtS == null) noTriage++;
            if (res!.firstHumanReplyAtS == null) noHumanReply++;
          }

          const patch = {
            triage_set_at: usable && res!.triageAtS != null
              ? new Date(res!.triageAtS * 1000).toISOString()
              : null,
            time_to_triage_s: usable ? res!.timeToTriageS : null,
            time_to_triage_bh_s: usable ? res!.timeToTriageBhS : null,
            first_human_reply_at: usable && res!.firstHumanReplyAtS != null
              ? new Date(res!.firstHumanReplyAtS * 1000).toISOString()
              : null,
            time_to_first_human_reply_s: usable ? res!.timeToFirstHumanReplyS : null,
            time_to_first_human_reply_bh_s: usable ? res!.timeToFirstHumanReplyBhS : null,
            responsiveness_computed_at: new Date().toISOString(),
            // Stamped even when not computable, so the row is not retried forever.
            responsiveness_engine_version: RESPONSIVENESS_ENGINE_VERSION,
          };
          const { error: upErr } = await supabase
            .from("intercom_tickets_v3")
            .update(patch)
            .eq("id", r.id);
          if (upErr) {
            failed++;
            console.error(`[backfill-responsiveness] ${r.intercom_conversation_id}: ${upErr.message}`);
          } else written++;
        } catch (e) {
          failed++;
          console.error(`[backfill-responsiveness] ${r.intercom_conversation_id}: ${(e as Error).message}`);
        }
      }

      if (rows.length < batch) break;
    }

    const { count } = await supabase
      .from("intercom_tickets_v3")
      .select("id", { count: "exact", head: true })
      .in("lifecycle_status", ["finalized", "reopened_after_finalize"])
      .or(`responsiveness_engine_version.is.null,responsiveness_engine_version.lt.${RESPONSIVENESS_ENGINE_VERSION}`);

    return json({
      ok: true,
      engine_version: RESPONSIVENESS_ENGINE_VERSION,
      processed,
      written,
      skipped_no_parts: skippedNoParts,
      no_triage: noTriage,
      no_human_reply: noHumanReply,
      failed,
      remaining: count ?? 0,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
