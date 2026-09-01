// sync-v3-closed
// ---------------------------------------------------------------------------
// Drains closed enterprise-inbox tickets into intercom_tickets_v3 and freezes
// them (lifecycle_status='finalized'). Resumable, time-boxed at ~120s.
//
// Modes (request body):
//   { mode: "incremental" }  — default. Picks up from last cursor stored in
//                              intercom_sync_jobs_v3(kind='closed_backfill').
//   { mode: "backfill", windowStart, windowEnd } — explicit window (used by
//                              gap-scan and manual catch-up).
//
// Per conversation:
//   - existing row finalized & closed_at matches  → skip
//   - existing row finalized & newer activity     → mark reopened_after_finalize
//                                                   (does NOT re-finalize)
//   - otherwise                                   → full GET + finalize write
// ---------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  classifyHttpStatus,
  recordIntegrationHealth,
} from "../_shared/integration-health.ts";
import {
  buildReopenUpdate,
  buildSilentNudgeUpdate,
  CLEAN_DATA_START_ISO,
  CLEAN_DATA_START_UNIX,
  decideFinalizedUpdate,
  domainOf,
  extractFields,
  extractTags,
  intercomHeaders,
  stripHtml,
  TIME_BUDGET_MS,
  tsToIso,
  V3_CORS_HEADERS,
} from "../_shared/v3.ts";
import { syncTicketAttributes } from "../_shared/v3-attributes.ts";
import { writeV3Signals } from "../_shared/v3-signals.ts";
import { activeClockFields } from "../_shared/v3-finalize.ts";
import { loadSupportRoster, registerConfiguredAnchors } from "../_shared/sla-roster.ts";
import { resolveInboxes, inboxSearchClause } from "../_shared/v3-inboxes.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: V3_CORS_HEADERS });

  const startedAt = Date.now();
  const INTERCOM_API_TOKEN = Deno.env.get("INTERCOM_API_TOKEN");
  if (!INTERCOM_API_TOKEN) {
    return json({ error: "INTERCOM_API_TOKEN not configured" }, 500);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let body: {
    mode?: "incremental" | "backfill";
    windowStart?: string;
    windowEnd?: string;
    maxBatch?: number;
  } = {};
  try { body = await req.json(); } catch { /* empty body fine */ }

  const mode = body.mode === "backfill" ? "backfill" : "incremental";
  const maxBatch = Math.min(body.maxBatch ?? 200, 500);

  const { data: settings } = await supabase
    .from("settings").select("*").limit(1).single();
  if (!settings?.intercom_inbox_id) {
    return json({ error: "No enterprise inbox configured" }, 400);
  }
  const inboxes = resolveInboxes(settings);

  let adminOwnerMap: Record<string, string> = {};
  try { adminOwnerMap = JSON.parse(settings.admin_owner_map || "{}"); } catch { /* */ }

  // Support roster + SSE anchor for the active-clock computation.
  await registerConfiguredAnchors(supabase);
  const roster = await loadSupportRoster(supabase);

  // -------------------------------------------------------------------------
  // Resolve search window (unix seconds)
  // -------------------------------------------------------------------------
  let sinceTs: number;
  let untilTs: number | null = null;
  let jobRowId: string | null = null;

  if (mode === "backfill" && body.windowStart) {
    const s = Math.floor(new Date(body.windowStart).getTime() / 1000);
    sinceTs = Math.max(s, CLEAN_DATA_START_UNIX);
    if (body.windowEnd) {
      untilTs = Math.floor(new Date(body.windowEnd).getTime() / 1000);
    }
    const { data: created } = await supabase
      .from("intercom_sync_jobs_v3")
      .insert({
        kind: "closed_backfill",
        status: "running",
        window_start: new Date(sinceTs * 1000).toISOString(),
        window_end: untilTs ? new Date(untilTs * 1000).toISOString() : null,
        started_at: new Date().toISOString(),
      })
      .select("id").single();
    jobRowId = created?.id ?? null;
  } else {
    // Incremental: read last finished cursor for closed_backfill
    const { data: last } = await supabase
      .from("intercom_sync_jobs_v3")
      .select("id, cursor_ts")
      .eq("kind", "closed_backfill")
      .order("created_at", { ascending: false })
      .limit(1).maybeSingle();

    const baseTs = last?.cursor_ts
      ? Math.floor(new Date(last.cursor_ts).getTime() / 1000)
      : CLEAN_DATA_START_UNIX;
    sinceTs = Math.max(baseTs, CLEAN_DATA_START_UNIX);

    const { data: created } = await supabase
      .from("intercom_sync_jobs_v3")
      .insert({
        kind: "closed_backfill",
        status: "running",
        window_start: new Date(sinceTs * 1000).toISOString(),
        started_at: new Date().toISOString(),
      })
      .select("id").single();
    jobRowId = created?.id ?? null;
  }

  console.log(`[sync-v3-closed] mode=${mode} since=${new Date(sinceTs * 1000).toISOString()} until=${untilTs ? new Date(untilTs * 1000).toISOString() : "—"}`);

  // -------------------------------------------------------------------------
  // Paginate Intercom search (closed in enterprise inbox, ordered by updated_at)
  // -------------------------------------------------------------------------
  const conversations: any[] = [];
  let startingAfter: string | null = null;
  let page = 0;
  // In backfill mode we paginate the entire window to exhaustion (subject only
  // to the wall-clock time budget). In incremental mode we cap pages to keep
  // each invocation cheap; the next run resumes from the cursor.
  const MAX_PAGES = mode === "backfill" ? Number.MAX_SAFE_INTEGER : 60;
  // Field used for the window filter. Gap-scan counts by statistics.last_close_at,
  // so backfill must search by the same field or the windows won't align (a
  // ticket closed in the day but touched the next day has updated_at outside
  // the window and would be missed). Incremental mode keeps using updated_at
  // so it picks up any post-close activity.
  const windowField = mode === "backfill" ? "statistics.last_close_at" : "updated_at";

  while (page < MAX_PAGES && (mode === "backfill" || conversations.length < maxBatch)) {
    if (Date.now() - startedAt > TIME_BUDGET_MS * 0.4) break;

    const clauses: any[] = [
      inboxSearchClause(inboxes.ids),
      { field: "state", operator: "=", value: "closed" },
      { field: windowField, operator: ">", value: sinceTs },
    ];
    if (untilTs) clauses.push({ field: windowField, operator: "<", value: untilTs });

    const reqBody: any = {
      query: { operator: "AND", value: clauses },
      pagination: { per_page: 50 },
      sort_field: windowField,
      sort_order: "ascending",
    };
    if (startingAfter) reqBody.pagination = { per_page: 50, starting_after: startingAfter };

    const res = await fetch("https://api.intercom.io/conversations/search", {
      method: "POST",
      headers: intercomHeaders(INTERCOM_API_TOKEN),
      body: JSON.stringify(reqBody),
    });
    if (!res.ok) {
      const text = await res.text();
      await recordIntegrationHealth(
        supabase, "inbox_v2_sync", classifyHttpStatus(res.status),
        `[v3-closed] search ${res.status}: ${text.slice(0, 200)}`,
      );
      await finishJob(supabase, jobRowId, "error", text.slice(0, 200));
      return json({ error: "Intercom search failed", status: res.status }, 502);
    }
    const data = await res.json();
    const list = data.conversations || data.data || [];
    for (const c of list) conversations.push(c);

    page++;
    const next = data.pages?.next?.starting_after;
    if (!next) break;
    startingAfter = next;
  }

  console.log(`[sync-v3-closed] fetched ${conversations.length} candidate closed convs`);

  // -------------------------------------------------------------------------
  // Bulk pre-fetch existing rows
  // -------------------------------------------------------------------------
  const convIds = conversations.map((c) => String(c.id));
  let existingMap = new Map<string, {
    id: string;
    lifecycle_status: string;
    intercom_closed_at: string | null;
    intercom_updated_at: string | null;
    reopen_count: number;
    reopen_count_at_finalize: number | null;
    silent_update_count: number | null;
    raw_payload: any;
  }>();
  if (convIds.length) {
    const { data: existing } = await supabase
      .from("intercom_tickets_v3")
      .select("id, intercom_conversation_id, lifecycle_status, intercom_closed_at, intercom_updated_at, reopen_count, reopen_count_at_finalize, silent_update_count, raw_payload")
      .in("intercom_conversation_id", convIds);
    for (const r of existing || []) {
      existingMap.set(String(r.intercom_conversation_id), r as any);
    }
  }

  let inserted = 0, updated = 0, failed = 0, reopened = 0, skipped = 0, silentNudges = 0;
  let maxUpdatedSeen = sinceTs;

  for (const conv of conversations) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) {
      console.log("[sync-v3-closed] time budget hit, stopping");
      break;
    }

    const convId = String(conv.id);
    const convUpdatedAt = typeof conv.updated_at === "number" ? conv.updated_at : 0;
    if (convUpdatedAt > maxUpdatedSeen) maxUpdatedSeen = convUpdatedAt;

    try {
      const existing = existingMap.get(convId);

      // Already-finalized row: decide reopen vs silent nudge using authoritative
      // Intercom signals (state, statistics.count_reopens). CSAT submissions,
      // tag/label edits, custom-attribute edits, and admin notes bump updated_at
      // but do NOT bump count_reopens — those land on the silent path.
      if (existing && existing.lifecycle_status === "finalized") {
        const decision = await decideFinalizedUpdate(
          async () => {
            const fRes = await fetch(`https://api.intercom.io/conversations/${convId}`, {
              headers: intercomHeaders(INTERCOM_API_TOKEN),
            });
            if (!fRes.ok) return null;
            return await fRes.json();
          },
          existing,
          convUpdatedAt,
        );
        if (decision.kind === "skip") { skipped++; continue; }
        if (decision.kind === "reopen") {
          await supabase.from("intercom_tickets_v3")
            .update(buildReopenUpdate(existing, decision.fData, convUpdatedAt))
            .eq("id", existing.id);
          try { await syncTicketAttributes(supabase, existing.id, decision.fData, { convId }); }
          catch (e) { console.error(`[sync-v3-closed] attr sync (reopen) ${convId}: ${(e as Error).message}`); }
          try { await writeV3Signals(supabase, existing.id, decision.fData, { convId }); }
          catch (e) { console.error(`[sync-v3-closed] signal write (reopen) ${convId}: ${(e as Error).message}`); }
          reopened++;
        } else {
          await supabase.from("intercom_tickets_v3")
            .update(buildSilentNudgeUpdate(existing, decision.fData, decision.silentChange, convUpdatedAt))
            .eq("id", existing.id);
          try { await syncTicketAttributes(supabase, existing.id, decision.fData, { convId }); }
          catch (e) { console.error(`[sync-v3-closed] attr sync (silent) ${convId}: ${(e as Error).message}`); }
          try { await writeV3Signals(supabase, existing.id, decision.fData, { convId }); }
          catch (e) { console.error(`[sync-v3-closed] signal write (silent) ${convId}: ${(e as Error).message}`); }
          silentNudges++;
        }
        continue;
      }

      // Full GET — needed for custom_attributes, tags, statistics, conversation_rating
      const icRes = await fetch(`https://api.intercom.io/conversations/${convId}`, {
        headers: intercomHeaders(INTERCOM_API_TOKEN),
      });
      if (!icRes.ok) { failed++; continue; }
      const icData = await icRes.json();

      // Inbox membership guard (defensive — search already filtered)
      if (!inboxes.isOurs(icData.team_assignee_id)) {
        skipped++;
        continue;
      }
      // Closed guard
      if (String(icData.state || "") !== "closed") {
        skipped++;
        continue;
      }

      // Contact
      let contactName = "";
      let contactEmail = "";
      const sa = icData.source?.author;
      if (sa) { contactName = sa.name || sa.email || ""; contactEmail = sa.email || ""; }
      if (!contactEmail && icData.contacts?.contacts?.length > 0) {
        const cid = icData.contacts.contacts[0].id;
        try {
          const cRes = await fetch(`https://api.intercom.io/contacts/${cid}`, {
            headers: intercomHeaders(INTERCOM_API_TOKEN),
          });
          if (cRes.ok) {
            const cd = await cRes.json();
            contactEmail = cd.email || "";
            if (!contactName) contactName = cd.name || contactEmail;
          }
        } catch { /* ignore */ }
      }

      const adminId = String(icData.admin_assignee_id || conv.admin_assignee_id || "");
      const owner = adminOwnerMap[adminId] || null;
      const { product_area, classification } = extractFields(icData);
      const tags = extractTags(icData);
      const subject = stripHtml(icData.source?.subject || icData.title || `Intercom #${convId}`);

      const cr = icData?.conversation_rating;
      const csat_rating = typeof cr?.rating === "number" ? cr.rating : null;
      const csat_remark = typeof cr?.remark === "string" && cr.remark.trim() ? cr.remark.trim() : null;
      const csat_rated_at = tsToIso(cr?.created_at);

      const stats = icData?.statistics || {};
      const time_to_first_admin_reply_s = typeof stats.time_to_admin_reply === "number"
        ? stats.time_to_admin_reply : null;
      const time_to_resolve_s = typeof stats.time_to_last_close === "number"
        ? stats.time_to_last_close : null;

      const createdIso = tsToIso(icData.created_at);
      const updatedIso = tsToIso(icData.updated_at);
      const closedIso = tsToIso(stats.last_close_at)
        ?? tsToIso(stats.last_closed_at)
        ?? updatedIso;

      // Hard cutoff: don't write rows before CLEAN_DATA_START
      if (createdIso && createdIso < CLEAN_DATA_START_ISO) {
        skipped++;
        continue;
      }

      // NOTE: customer_key / customer_kind / customer_source are populated by
      // the BEFORE INSERT/UPDATE trigger `intercom_tickets_v3_apply_customer`.
      // See supabase/functions/_shared/v3-customer.ts for the lockstep contract.
      const row = {
        intercom_conversation_id: convId,
        team_assignee_id: String(icData.team_assignee_id ?? ""),
        plan_tier: inboxes.planFor(icData.team_assignee_id) ?? "enterprise",
        admin_assignee_id: adminId || null,
        owner,
        contact_name: contactName || null,
        contact_email: contactEmail || null,
        contact_domain: domainOf(contactEmail),
        subject,
        state: String(icData.state || "closed"),
        lifecycle_status: "finalized",
        product_area,
        classification,
        tags,
        csat_rating,
        csat_remark,
        csat_rated_at,
        time_to_first_admin_reply_s,
        time_to_resolve_s,
        intercom_created_at: createdIso,
        intercom_updated_at: updatedIso,
        intercom_closed_at: closedIso,
        finalized_at: new Date().toISOString(),
        last_synced_at: new Date().toISOString(),
        last_full_fetch_at: new Date().toISOString(),
        raw_payload: icData,
        reopen_count_at_finalize: Number(icData?.statistics?.count_reopens ?? 0),
        // Active resolution clock (dormant/closed time excluded) — shared rule.
        ...activeClockFields(icData, roster),
      };

      const { data: upserted, error } = await supabase
        .from("intercom_tickets_v3")
        .upsert(row, { onConflict: "intercom_conversation_id" })
        .select("id")
        .single();
      if (error) { console.error(`[sync-v3-closed] upsert ${convId}:`, error.message); failed++; continue; }
      if (upserted?.id) {
        try { await syncTicketAttributes(supabase, upserted.id, icData, { convId }); }
        catch (e) { console.error(`[sync-v3-closed] attr sync ${convId}: ${(e as Error).message}`); }
        try { await writeV3Signals(supabase, upserted.id, icData, { convId }); }
        catch (e) { console.error(`[sync-v3-closed] signal write ${convId}: ${(e as Error).message}`); }
      }
      if (existing) updated++; else inserted++;
    } catch (e) {
      console.error(`[sync-v3-closed] err on ${convId}:`, (e as Error).message);
      failed++;
    }
  }

  // Persist cursor as max(updated_at) we observed, clamped >= sinceTs
  const cursorIso = new Date(Math.max(maxUpdatedSeen, sinceTs) * 1000).toISOString();
  await supabase.from("intercom_sync_jobs_v3").update({
    status: "done",
    cursor_ts: cursorIso,
    processed: conversations.length,
    inserted,
    updated_count: updated,
    failed,
    finished_at: new Date().toISOString(),
  }).eq("id", jobRowId!);

  await recordIntegrationHealth(supabase, "inbox_v2_sync", "ok"); // reuse v2 health bucket for now

  return json({
    ok: true,
    mode,
    fetched: conversations.length,
    inserted,
    updated,
    reopened,
    silent_nudges: silentNudges,
    skipped,
    failed,
    cursor_ts: cursorIso,
    elapsed_ms: Date.now() - startedAt,
  });
});

function json(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...V3_CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function finishJob(
  sb: any, id: string | null, status: "done" | "error", err?: string,
) {
  if (!id) return;
  await sb.from("intercom_sync_jobs_v3").update({
    status,
    last_error: err ?? null,
    finished_at: new Date().toISOString(),
  }).eq("id", id);
}

