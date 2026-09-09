// Backfill the persisted active resolution clock on intercom_tickets_v3.
//
// Computes ENTIRELY from the stored `raw_payload` — no Intercom API calls.
// Re-runnable: rows already at ACTIVE_CLOCK_ENGINE_VERSION are skipped unless
// `force` is passed. Rows whose payload has no usable timeline are counted as
// `skipped_no_parts` and left NULL — never zeroed.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.4";
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";
import { computeActiveClock, hasCustomerReply, ACTIVE_CLOCK_ENGINE_VERSION } from "../_shared/sla-core.ts";
import { loadSupportRoster, registerConfiguredAnchors } from "../_shared/sla-roster.ts";
import { loadEngEscalations } from "../_shared/eng-wait.ts";
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
    let failed = 0;
    let remaining = 0;

    for (let b = 0; b < maxBatches; b++) {
      let q = supabase
        .from("intercom_tickets_v3")
        .select("id,intercom_conversation_id,raw_payload")
        .in("lifecycle_status", ["finalized", "reopened_after_finalize"])
        .order("intercom_created_at", { ascending: false })
        .limit(batch);
      if (!force) {
        q = q.or(
          `active_clock_engine_version.is.null,active_clock_engine_version.lt.${ACTIVE_CLOCK_ENGINE_VERSION}`,
        );
      }
      const { data, error } = await q;
      if (error) return json({ error: error.message }, 500);
      const rows = data ?? [];
      if (rows.length === 0) break;

      // Engineering-wait facts for this batch, loaded once (Engine v3).
      const escalations = await loadEngEscalations(
        supabase,
        rows.map((r: any) => r.intercom_conversation_id),
      );

      for (const r of rows as Array<{ id: string; intercom_conversation_id: string; raw_payload: any }>) {
        processed++;
        try {
          const raw = r.raw_payload;
          const ac = raw
            ? computeActiveClock(raw, {
                roster,
                escalation: escalations.get(r.intercom_conversation_id) ?? null,
              })
            : null;
          const usable = !!ac && ac.partsCount > 0;
          if (!usable) skippedNoParts++;

          const patch = {
            outbound_initiated: usable ? ac!.outboundInitiated : null,
            customer_replied: usable ? hasCustomerReply(raw) : null,
            resolution_active_s: usable ? ac!.resolutionActiveS : null,

            resolution_active_bh_s: usable ? ac!.resolutionActiveBhS : null,
            resolution_closed_s: usable ? ac!.resolutionClosedS : null,
            resolution_customer_wait_s: usable ? ac!.resolutionCustomerWaitS : null,
            resolution_customer_wait_bh_s: usable ? ac!.resolutionCustomerWaitBhS : null,
            resolution_eng_wait_s: usable ? ac!.resolutionEngWaitS : null,
            resolution_eng_wait_bh_s: usable ? ac!.resolutionEngWaitBhS : null,
            eng_wait_start_at: usable && ac!.engWaitStartS != null
              ? new Date(ac!.engWaitStartS * 1000).toISOString()
              : null,
            eng_wait_end_at: usable && ac!.engWaitEndS != null
              ? new Date(ac!.engWaitEndS * 1000).toISOString()
              : null,
            eng_wait_source: usable ? ac!.engWaitSource : null,
            resolution_window_s: usable ? ac!.resolutionWindowS : null,
            sla_clock_start_at: usable && ac!.slaClockStartS != null
              ? new Date(ac!.slaClockStartS * 1000).toISOString()
              : null,
            active_clock_computed_at: new Date().toISOString(),
            // Stamped even when not computable, so the row is not retried forever.
            active_clock_engine_version: ACTIVE_CLOCK_ENGINE_VERSION,
          };
          const { error: upErr } = await supabase
            .from("intercom_tickets_v3")
            .update(patch)
            .eq("id", r.id);
          if (upErr) { failed++; console.error(`[backfill-active-clock] ${r.intercom_conversation_id}: ${upErr.message}`); }
          else written++;
        } catch (e) {
          failed++;
          console.error(`[backfill-active-clock] ${r.intercom_conversation_id}: ${(e as Error).message}`);
        }
      }

      if (rows.length < batch) break;
    }

    const { count } = await supabase
      .from("intercom_tickets_v3")
      .select("id", { count: "exact", head: true })
      .in("lifecycle_status", ["finalized", "reopened_after_finalize"])
      .or(`active_clock_engine_version.is.null,active_clock_engine_version.lt.${ACTIVE_CLOCK_ENGINE_VERSION}`);
    remaining = count ?? 0;

    return json({
      ok: true,
      engine_version: ACTIVE_CLOCK_ENGINE_VERSION,
      processed,
      written,
      skipped_no_parts: skippedNoParts,
      failed,
      remaining,
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
});
