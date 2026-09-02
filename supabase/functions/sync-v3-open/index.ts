// sync-v3-open
// ---------------------------------------------------------------------------
// Cheap freshness pass for OPEN enterprise tickets. Search-payload only.
// Does NOT call GET /conversations/{id}. Deliberately skips product_area,
// classification, tags, statistics, csat — those aren't trusted until close
// (sync-v3-closed handles them).
//
// Writes minimal fields so the v3 inbox view can show open work in near-real-time.
// ---------------------------------------------------------------------------

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";
import {
  buildReopenUpdate,
  buildSilentNudgeUpdate,
  CLEAN_DATA_START_UNIX,
  decideFinalizedUpdate,
  domainOf,
  extractTags,
  intercomHeaders,
  isFinalizedTicketState,
  isTicketPayload,
  stripHtml,
  TIME_BUDGET_MS,
  tsToIso,
  V3_CORS_HEADERS,
} from "../_shared/v3.ts";
import { finalizeConversation } from "../_shared/v3-finalize.ts";
import { loadSupportRoster, registerConfiguredAnchors } from "../_shared/sla-roster.ts";
import { syncTicketAttributes } from "../_shared/v3-attributes.ts";
import { writeV3Signals } from "../_shared/v3-signals.ts";
import { notifyNewTicket } from "../_shared/new-ticket-alert.ts";
import { resolveInboxes, inboxSearchClause } from "../_shared/v3-inboxes.ts";
import { requireEditorOrSecret } from "../_shared/require-editor-or-secret.ts";



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

  let body: { windowHours?: number } = {};
  try { body = await req.json(); } catch {}
  // Cap raised to 720h (30d) so a daily wide-sweep cron + on-demand backfills can
  // pull idle-open tickets that the 5-min 2h pass never sees.
  const windowHours = Math.max(1, Math.min(720, body.windowHours ?? 2));

  const { data: settings } = await supabase.from("settings").select("*").limit(1).single();
  if (!settings?.intercom_inbox_id) return json({ error: "No enterprise inbox configured" }, 400);
  const inboxes = resolveInboxes(settings);

  let adminOwnerMap: Record<string, string> = {};
  try { adminOwnerMap = JSON.parse(settings.admin_owner_map || "{}"); } catch {}

  // Support roster + SSE anchor for the active-clock computation at finalize.
  await registerConfiguredAnchors(supabase);
  const roster = await loadSupportRoster(supabase);

  const sinceTs = Math.max(
    Math.floor((Date.now() - windowHours * 3600 * 1000) / 1000),
    CLEAN_DATA_START_UNIX,
  );

  const { data: jobRow } = await supabase.from("intercom_sync_jobs_v3").insert({
    kind: "open_refresh",
    status: "running",
    window_start: new Date(sinceTs * 1000).toISOString(),
    started_at: new Date().toISOString(),
  }).select("id").single();

  const conversations: any[] = [];
  let startingAfter: string | null = null;
  let page = 0;
  const MAX_PAGES = 40;

  while (page < MAX_PAGES) {
    if (Date.now() - startedAt > TIME_BUDGET_MS * 0.5) break;

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
          { field: "updated_at", operator: ">", value: sinceTs },
        ],
      },
      pagination: { per_page: 50 },
    };
    if (startingAfter) reqBody.pagination = { per_page: 50, starting_after: startingAfter };

    const res = await fetch("https://api.intercom.io/conversations/search", {
      method: "POST",
      headers: intercomHeaders(INTERCOM_API_TOKEN),
      body: JSON.stringify(reqBody),
    });
    if (!res.ok) {
      const text = await res.text();
      await supabase.from("intercom_sync_jobs_v3").update({
        status: "error", last_error: `search ${res.status}: ${text.slice(0, 200)}`,
        finished_at: new Date().toISOString(),
      }).eq("id", jobRow?.id);
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


  // Pre-fetch existing rows so we can route finalized ones to the
  // reopen/silent-nudge path (mirroring sync-v3-closed) instead of clobbering them.
  const ids = conversations.map((c) => String(c.id));
  const existingFinalized = new Map<string, any>();
  // Non-finalized rows, used for the delta check that decides whether an open
  // ticket needs a full GET (to refresh custom_attributes / raw_payload / signals).
  const existingOpen = new Map<string, { id: string; intercom_updated_at: string | null; last_full_fetch_at: string | null }>();
  if (ids.length) {
    const { data: existing } = await supabase
      .from("intercom_tickets_v3")
      .select("id, intercom_conversation_id, lifecycle_status, intercom_updated_at, last_full_fetch_at, reopen_count, reopen_count_at_finalize, silent_update_count, raw_payload")
      .in("intercom_conversation_id", ids);
    for (const r of existing || []) {
      if (r.lifecycle_status === "finalized") {
        existingFinalized.set(String(r.intercom_conversation_id), r);
      } else {
        existingOpen.set(String(r.intercom_conversation_id), {
          id: r.id,
          intercom_updated_at: r.intercom_updated_at,
          last_full_fetch_at: r.last_full_fetch_at,
        });
      }
    }
  }

  let inserted = 0, updated = 0, skipped = 0, failed = 0, reopened = 0, silentNudges = 0, ticketsFinalized = 0, attrRefreshed = 0, alerted = 0;


  for (const conv of conversations) {
    const convId = String(conv.id);
    try {
      const createdIso = tsToIso(conv.created_at);
      if (createdIso && createdIso < new Date(CLEAN_DATA_START_UNIX * 1000).toISOString()) {
        skipped++; continue;
      }

      // Finalized row that re-surfaced in the open/snoozed search → could be a
      // true reopen OR a silent nudge (CSAT, tags, label, note). Use the shared
      // helper so both syncs apply identical detection logic and field writes.
      const finalized = existingFinalized.get(convId);
      if (finalized) {
        const convUpdatedAt = typeof conv.updated_at === "number" ? conv.updated_at : 0;
        const decision = await decideFinalizedUpdate(
          async () => {
            const fRes = await fetch(`https://api.intercom.io/conversations/${convId}`, {
              headers: intercomHeaders(INTERCOM_API_TOKEN),
            });
            if (!fRes.ok) return null;
            return await fRes.json();
          },
          finalized,
          convUpdatedAt,
        );
        if (decision.kind === "skip") { skipped++; continue; }
        if (decision.kind === "reopen") {
          await supabase.from("intercom_tickets_v3")
            .update(buildReopenUpdate(finalized, decision.fData, convUpdatedAt))
            .eq("id", finalized.id);
          try { await syncTicketAttributes(supabase, finalized.id, decision.fData, { convId }); }
          catch (e) { console.error(`[sync-v3-open] attr sync (reopen) ${convId}: ${(e as Error).message}`); }
          try { await writeV3Signals(supabase, finalized.id, decision.fData, { convId }); }
          catch (e) { console.error(`[sync-v3-open] signal write (reopen) ${convId}: ${(e as Error).message}`); }
          reopened++;
        } else {
          await supabase.from("intercom_tickets_v3")
            .update(buildSilentNudgeUpdate(finalized, decision.fData, decision.silentChange, convUpdatedAt))
            .eq("id", finalized.id);
          try { await syncTicketAttributes(supabase, finalized.id, decision.fData, { convId }); }
          catch (e) { console.error(`[sync-v3-open] attr sync (silent) ${convId}: ${(e as Error).message}`); }
          try { await writeV3Signals(supabase, finalized.id, decision.fData, { convId }); }
          catch (e) { console.error(`[sync-v3-open] signal write (silent) ${convId}: ${(e as Error).message}`); }
          silentNudges++;
        }
        continue;
      }

      // Intercom Tickets (conversations converted to tickets) keep top-level
      // state="open" even when resolved — closed-sync never sees them. If the
      // search payload shows a resolved/archived ticket, run the full finalize
      // path here (single GET) so it lands on the Finalized tab.
      if (isTicketPayload(conv) && isFinalizedTicketState(conv)) {
        const result = await finalizeConversation({
          supabase,
          intercomToken: INTERCOM_API_TOKEN,
          convId,
          inboxes,
          adminOwnerMap,
          existing: null,
          roster,
        });
        if (result.kind === "inserted" || result.kind === "updated") ticketsFinalized++;
        else if (result.kind === "skipped") skipped++;
        else failed++;
        continue;
      }



      // Search-payload derived fields (shared by the minimal and full paths).
      const sa = conv.source?.author;
      const contactName: string | null = sa?.name || sa?.email || null;
      const contactEmail: string | null = sa?.email || null;
      const adminId = String(conv.admin_assignee_id ?? "");
      const owner = adminOwnerMap[adminId] || null;
      const subject = stripHtml(conv.source?.subject || conv.title || `Intercom #${convId}`);

      // NOTE: customer_key / customer_kind / customer_source are populated by
      // the BEFORE INSERT/UPDATE trigger `intercom_tickets_v3_apply_customer`.
      // Keep DB trigger + Deno helper (_shared/v3-customer.ts) in lockstep.
      const row = {
        intercom_conversation_id: convId,
        team_assignee_id: String(conv.team_assignee_id ?? ""),
        plan_tier: inboxes.planFor(conv.team_assignee_id) ?? "enterprise",
        admin_assignee_id: adminId || null,
        owner,
        contact_name: contactName,
        contact_email: contactEmail,
        contact_domain: domainOf(contactEmail),
        subject,
        state: String(conv.state || "open"),
        // lifecycle_status defaults to 'open' on insert; we only set on insert
        intercom_created_at: createdIso,
        intercom_updated_at: tsToIso(conv.updated_at),
        last_synced_at: new Date().toISOString(),
      };

      // Alert on tickets that are new to our store AND genuinely recent, so a
      // wide backfill sweep can't spam the channel with historical tickets.
      const maybeAlert = async () => {
        const createdMs = createdIso ? new Date(createdIso).getTime() : 0;
        if (Date.now() - createdMs > 24 * 3600 * 1000) return;
        const r = await notifyNewTicket(supabase, {
          convId,
          subject,
          contactName,
          contactEmail,
          owner,
          createdIso,
        });
        if (r === "sent") alerted++;
      };

      // Minimal, search-payload-only upsert (NO GET /conversations/{id}).
      const minimalUpsert = async (): Promise<string | null> => {
        const { error, data: upserted } = await supabase
          .from("intercom_tickets_v3")
          .upsert(row, { onConflict: "intercom_conversation_id" })
          .select("id, created_at");
        if (error) { failed++; return null; }
        if (upserted && upserted[0]) {
          const isNew = Date.now() - new Date(upserted[0].created_at).getTime() < 5000;
          if (isNew) { inserted++; await maybeAlert(); } else updated++;
          return upserted[0].id as string;
        }
        updated++;
        return null;
      };


      // Delta check: open tickets carry stale `custom_attributes` (Severity →
      // SLA target) because the minimal path never refreshes them. Spend a
      // single GET when the ticket is new to us or has changed since last sync.
      const existingRow = existingOpen.get(convId);
      const convUpdatedUnix = typeof conv.updated_at === "number" ? conv.updated_at : 0;
      const lastFullUnix = existingRow?.last_full_fetch_at
        ? Math.floor(new Date(existingRow.last_full_fetch_at).getTime() / 1000)
        : 0;
      // Refresh when the ticket has changed since our last FULL fetch (not since the
      // last minimal sync — the minimal path advances intercom_updated_at, which
      // would otherwise suppress the full fetch forever and leave attributes stale).
      const needFull = !existingRow || !existingRow.last_full_fetch_at || convUpdatedUnix > lastFullUnix;

      if (!needFull) { await minimalUpsert(); continue; }

      const fRes = await fetch(`https://api.intercom.io/conversations/${convId}`, {
        headers: intercomHeaders(INTERCOM_API_TOKEN),
      });
      if (!fRes.ok) { await minimalUpsert(); continue; }
      const icData = await fRes.json();

      // Moved out of the Enterprise Inbox between search and GET → minimal only.
      if (!inboxes.isOurs(icData.team_assignee_id)) {
        await minimalUpsert();
        continue;
      }

      // Closed/resolved since the search snapshot → hand to the finalize path.
      if (String(icData.state || "") === "closed" || (isTicketPayload(icData) && isFinalizedTicketState(icData))) {
        const result = await finalizeConversation({
          supabase,
          intercomToken: INTERCOM_API_TOKEN,
          convId,
          inboxes,
          adminOwnerMap,
          existing: existingRow ? { id: existingRow.id } : null,
          roster,
        });
        if (result.kind === "inserted" || result.kind === "updated") ticketsFinalized++;
        else if (result.kind === "skipped") skipped++;
        else failed++;
        continue;
      }

      // Still open: minimal row PLUS raw_payload so attributes/signals refresh.
      // Deliberately NOT refreshing product_area/classification/tags/csat —
      // those stay close-only (sync-v3-closed owns them).
      const { error, data: upserted } = await supabase
        .from("intercom_tickets_v3")
        .upsert({ ...row, raw_payload: icData, tags: extractTags(icData), last_full_fetch_at: new Date().toISOString() }, { onConflict: "intercom_conversation_id" })
        .select("id, created_at");
      if (error) { failed++; continue; }
      if (upserted && upserted[0]) {
        const isNew = Date.now() - new Date(upserted[0].created_at).getTime() < 5000;
        if (isNew) { inserted++; await maybeAlert(); } else updated++;

        const ticketId = upserted[0].id;
        try { await syncTicketAttributes(supabase, ticketId, icData, { convId }); }
        catch (e) { console.error(`[sync-v3-open] attr sync (open) ${convId}: ${(e as Error).message}`); }
        try { await writeV3Signals(supabase, ticketId, icData, { convId }); }
        catch (e) { console.error(`[sync-v3-open] signal write (open) ${convId}: ${(e as Error).message}`); }
        attrRefreshed++;
      } else {
        updated++;
      }

    } catch (e) {
      console.error(`[sync-v3-open] err on ${convId}:`, (e as Error).message);
      failed++;
    }
  }

  await supabase.from("intercom_sync_jobs_v3").update({
    status: "done",
    processed: conversations.length,
    inserted,
    updated_count: updated,
    failed,
    finished_at: new Date().toISOString(),
  }).eq("id", jobRow?.id);

  const stateCounts = conversations.reduce((acc: any, c: any) => {
    const s = String(c.state || "?");
    acc[s] = (acc[s] || 0) + 1;
    return acc;
  }, {});

  return json({
    ok: true, windowHours, fetched: conversations.length,
    inserted, updated, skipped, failed, reopened, silent_nudges: silentNudges, tickets_finalized: ticketsFinalized,
    attr_refreshed: attrRefreshed, alerted,

    stateCounts,
    elapsed_ms: Date.now() - startedAt,
  });
});

function json(p: unknown, status = 200) {
  return new Response(JSON.stringify(p), {
    status,
    headers: { ...V3_CORS_HEADERS, "Content-Type": "application/json" },
  });
}
