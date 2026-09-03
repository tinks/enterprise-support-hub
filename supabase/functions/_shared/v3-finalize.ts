// Shared "finalize a single conversation/ticket" writer used by sync-v3-closed
// (its main loop) and sync-v3-open (when a resolved Ticket is discovered in the
// open sweep — Tickets keep top-level state="open" so the closed-side search
// never sees them).

import {
  extractFields,
  extractTags,
  intercomHeaders,
  isTicketPayload,
  isFinalizedTicketState,
  stripHtml,
  tsToIso,
  CLEAN_DATA_START_ISO,
  domainOf,
} from "./v3.ts";
import { syncTicketAttributes } from "./v3-attributes.ts";
import { writeV3Signals } from "./v3-signals.ts";
import type { InboxResolver } from "./v3-inboxes.ts";
import { computeActiveClock, computeResponsiveness } from "./sla-core.ts";
import type { SupportRoster, EngEscalation } from "./sla-core.ts";
import { hasLinearReference, loadEngEscalation } from "./eng-wait.ts";

export type FinalizeResult =
  | { kind: "inserted" | "updated" }
  | { kind: "skipped"; reason: string }
  | { kind: "failed"; reason: string };

/**
 * Active-clock columns for a finalize upsert. Never throws: a payload the
 * engine can't read leaves the columns null (reported as "not computable")
 * rather than writing a fabricated zero.
 */
export function activeClockFields(
  icData: any,
  roster?: SupportRoster,
  escalation?: EngEscalation[] | EngEscalation | null,
) {
  try {
    const ac = computeActiveClock(icData, { roster, escalation });
    return {
      resolution_active_s: ac.resolutionActiveS,
      resolution_active_bh_s: ac.resolutionActiveBhS,
      resolution_closed_s: ac.resolutionClosedS,
      resolution_customer_wait_s: ac.resolutionCustomerWaitS,
      resolution_customer_wait_bh_s: ac.resolutionCustomerWaitBhS,
      resolution_eng_wait_s: ac.resolutionEngWaitS,
      resolution_eng_wait_bh_s: ac.resolutionEngWaitBhS,
      eng_wait_start_at: ac.engWaitStartS != null
        ? new Date(ac.engWaitStartS * 1000).toISOString()
        : null,
      eng_wait_end_at: ac.engWaitEndS != null
        ? new Date(ac.engWaitEndS * 1000).toISOString()
        : null,
      eng_wait_source: ac.engWaitSource,
      resolution_window_s: ac.resolutionWindowS,
      sla_clock_start_at: ac.slaClockStartS != null
        ? new Date(ac.slaClockStartS * 1000).toISOString()
        : null,
      active_clock_computed_at: new Date().toISOString(),
      active_clock_engine_version: ac.engineVersion,
    };
  } catch (e) {
    console.error(`[v3-finalize] active clock failed: ${(e as Error).message}`);
    return {
      resolution_active_s: null,
      resolution_active_bh_s: null,
      resolution_closed_s: null,
      resolution_customer_wait_s: null,
      resolution_customer_wait_bh_s: null,
      resolution_eng_wait_s: null,
      resolution_eng_wait_bh_s: null,
      eng_wait_start_at: null,
      eng_wait_end_at: null,
      eng_wait_source: null,
      resolution_window_s: null,
      sla_clock_start_at: null,
      active_clock_computed_at: null,
      active_clock_engine_version: null,
    };
  }
}

/**
 * Responsiveness columns (time to triage, time to first HUMAN reply) for a
 * finalize upsert. Never throws: an unreadable payload leaves the columns null
 * rather than writing a fabricated zero.
 */
export function responsivenessFields(icData: any, roster?: SupportRoster) {
  try {
    const r = computeResponsiveness(icData, { roster });
    return {
      triage_set_at: r.triageAtS != null ? new Date(r.triageAtS * 1000).toISOString() : null,
      time_to_triage_s: r.timeToTriageS,
      time_to_triage_bh_s: r.timeToTriageBhS,
      first_human_reply_at:
        r.firstHumanReplyAtS != null ? new Date(r.firstHumanReplyAtS * 1000).toISOString() : null,
      time_to_first_human_reply_s: r.timeToFirstHumanReplyS,
      time_to_first_human_reply_bh_s: r.timeToFirstHumanReplyBhS,
      responsiveness_computed_at: new Date().toISOString(),
      responsiveness_engine_version: r.engineVersion,
    };
  } catch (e) {
    console.error(`[v3-finalize] responsiveness failed: ${(e as Error).message}`);
    return {
      triage_set_at: null,
      time_to_triage_s: null,
      time_to_triage_bh_s: null,
      first_human_reply_at: null,
      time_to_first_human_reply_s: null,
      time_to_first_human_reply_bh_s: null,
      responsiveness_computed_at: null,
      responsiveness_engine_version: null,
    };
  }
}

/**
 * Escalation facts for the active clock, loaded only when the payload actually
 * references a Linear issue. Never throws.
 */
export async function loadClockEscalation(
  supabase: any,
  convId: string,
  icData: any,
): Promise<EngEscalation[] | null> {
  try {
    if (!hasLinearReference(icData)) return null;
    return await loadEngEscalation(supabase, convId);
  } catch (e) {
    console.error(`[v3-finalize] escalation load failed: ${(e as Error).message}`);
    return null;
  }
}

export async function finalizeConversation(params: {
  supabase: any;
  intercomToken: string;
  convId: string;
  /** All ingested inboxes + their plan tiers (enterprise / sse). */
  inboxes: InboxResolver;
  adminOwnerMap: Record<string, string>;
  existing?: { id: string } | null;
  /** Support roster for relay re-attribution in the active clock. */
  roster?: SupportRoster;
}): Promise<FinalizeResult> {
  const { supabase, intercomToken, convId, inboxes, adminOwnerMap, existing } = params;

  const icRes = await fetch(`https://api.intercom.io/conversations/${convId}`, {
    headers: intercomHeaders(intercomToken),
  });
  if (!icRes.ok) return { kind: "failed", reason: `GET ${icRes.status}` };
  const icData = await icRes.json();

  const planTier = inboxes.planFor(icData.team_assignee_id);
  if (!planTier) {
    return { kind: "skipped", reason: "not_enterprise_inbox" };
  }


  const isTicket = isTicketPayload(icData);
  const closedConv = String(icData.state || "") === "closed";
  const resolvedTicket = isTicket && isFinalizedTicketState(icData);
  if (!closedConv && !resolvedTicket) {
    return { kind: "skipped", reason: "not_closed" };
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
        headers: intercomHeaders(intercomToken),
      });
      if (cRes.ok) {
        const cd = await cRes.json();
        contactEmail = cd.email || "";
        if (!contactName) contactName = cd.name || contactEmail;
      }
    } catch { /* ignore */ }
  }

  const clockEscalation = await loadClockEscalation(supabase, convId, icData);
  const adminId = String(icData.admin_assignee_id || "");
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
  // Tickets have no last_close_at — fall back to updated_at (approx. resolve time).
  const closedIso = tsToIso(stats.last_close_at)
    ?? tsToIso(stats.last_closed_at)
    ?? updatedIso;

  if (createdIso && createdIso < CLEAN_DATA_START_ISO) {
    return { kind: "skipped", reason: "before_data_floor" };
  }

  // Persist top-level state as "closed" so downstream filters treat resolved
  // Tickets identically to closed conversations. Retain the ticket block in
  // raw_payload for audit.
  const persistedState = closedConv ? String(icData.state || "closed") : "closed";

  const row = {
    intercom_conversation_id: convId,
    team_assignee_id: String(icData.team_assignee_id ?? ""),
    plan_tier: planTier,

    admin_assignee_id: adminId || null,
    owner,
    contact_name: contactName || null,
    contact_email: contactEmail || null,
    contact_domain: domainOf(contactEmail),
    subject,
    state: persistedState,
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

    // Active resolution clock — dormant/closed time excluded. Same rule as the
    // frontend engine (both call `_shared/sla-core.ts`). Recomputed on every
    // finalize, so a real reopen refreshes it.
    ...activeClockFields(icData, params.roster, clockEscalation),

    // Responsiveness — time to triage (Severity set) and time to first HUMAN
    // reply, both anchored at the SLA clock start. Same engine as the reports.
    ...responsivenessFields(icData, params.roster),
  };

  const { data: upserted, error } = await supabase
    .from("intercom_tickets_v3")
    .upsert(row, { onConflict: "intercom_conversation_id" })
    .select("id")
    .single();
  if (error) return { kind: "failed", reason: error.message };

  // Mirror custom_attributes into jsonb + normalized store. Errors logged, not thrown.
  if (upserted?.id) {
    try {
      await syncTicketAttributes(supabase, upserted.id, icData, { convId });
    } catch (e) {
      console.error(`[v3-finalize] attribute sync threw for conv=${convId}: ${(e as Error).message}`);
    }
    try {
      await writeV3Signals(supabase, upserted.id, icData, { convId });
    } catch (e) {
      console.error(`[v3-finalize] signal write threw for conv=${convId}: ${(e as Error).message}`);
    }
  }

  return { kind: existing ? "updated" : "inserted" };
}
