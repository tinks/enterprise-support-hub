// Shared constants and helpers for Inbox v3 sync functions.
// Duplicated from src/pages/inbox-v3/constants.ts (Deno cannot import from /src).

export const CLEAN_DATA_START_ISO = "2026-06-01T00:00:00Z";
export const CLEAN_DATA_START_UNIX = Math.floor(
  new Date(CLEAN_DATA_START_ISO).getTime() / 1000,
);

export const V3_CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

export function stripHtml(html: string): string {
  return (html || "")
    .replace(/<[^>]*>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

export function domainOf(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).toLowerCase() : null;
}

export function tsToIso(t: number | null | undefined): string | null {
  return typeof t === "number" && t > 0 ? new Date(t * 1000).toISOString() : null;
}

export function intercomHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
    Accept: "application/json",
    "Intercom-Version": "2.11",
  };
}

export function extractTags(icData: any): string[] {
  const arr = icData?.tags?.tags;
  if (!Array.isArray(arr)) return [];
  const out: string[] = [];
  for (const t of arr) {
    const name = typeof t?.name === "string" ? t.name.trim() : "";
    if (name) out.push(name);
  }
  return out;
}

export function extractFields(icData: any): {
  product_area: string | null;
  classification: string | null;
} {
  const ca = icData?.custom_attributes || {};
  const pa = typeof ca["Affected Product Area"] === "string"
    ? ca["Affected Product Area"].trim()
    : "";
  const tt = typeof ca["Ticket type"] === "string"
    ? ca["Ticket type"].trim()
    : "";
  return { product_area: pa || null, classification: tt || null };
}

export const TIME_BUDGET_MS = 120_000;

// Intercom Tickets (conversations converted to tickets) keep top-level
// state="open" even when resolved — the truth lives in `ticket.state`. Treat
// resolved/archived tickets as closed-equivalent for finalize/reopen logic.
export function isTicketPayload(conv: any): boolean {
  return !!conv?.ticket && typeof conv.ticket === "object";
}
export function isFinalizedTicketState(conv: any): boolean {
  const s = String(conv?.ticket?.state || "").toLowerCase();
  return s === "resolved" || s === "archived";
}
// True when the conversation should be considered "closed" for v3 reporting
// purposes — either a normal closed conversation, or a resolved/archived Ticket.
export function isClosedLike(conv: any): boolean {
  if (String(conv?.state || "") === "closed") return true;
  if (isTicketPayload(conv) && isFinalizedTicketState(conv)) return true;
  return false;
}


// ---------------------------------------------------------------------------
// Reopen vs silent-nudge detection for already-finalized rows.
// Used by BOTH sync-v3-closed and sync-v3-open so the two paths can't drift.
//
// Authoritative signals: Intercom `state` and `statistics.count_reopens`
// (compared against the baseline captured at finalize time). CSAT submissions,
// tag/label edits, custom-attribute edits, and admin notes bump `updated_at`
// but do NOT bump count_reopens — those land on the silent path.
// ---------------------------------------------------------------------------
export type FinalizedExisting = {
  id: string;
  lifecycle_status: string;
  intercom_updated_at: string | null;
  reopen_count: number;
  reopen_count_at_finalize: number | null;
  silent_update_count: number | null;
  raw_payload: any;
};

export type ReopenDecision =
  | { kind: "skip" }
  | { kind: "reopen"; fData: any }
  | { kind: "silent"; fData: any; silentChange: any };

export async function decideFinalizedUpdate(
  fetchFullPayload: () => Promise<any | null>,
  existing: FinalizedExisting,
  convUpdatedAt: number,
): Promise<ReopenDecision> {
  const existingUpdatedSec = existing.intercom_updated_at
    ? Math.floor(new Date(existing.intercom_updated_at).getTime() / 1000)
    : 0;
  if (convUpdatedAt <= existingUpdatedSec) return { kind: "skip" };

  const fData = await fetchFullPayload();
  if (!fData) return { kind: "skip" };

  const newState = String(fData.state || "");
  const newReopens = Number(fData?.statistics?.count_reopens ?? 0);
  const baselineReopens = Number(existing.reopen_count_at_finalize ?? 0);
  // Tickets stay top-level state="open" even when ticket.state="resolved";
  // use isClosedLike so a resolved ticket doesn't get re-flagged as a reopen
  // on every sync.
  const stillClosed = newState === "closed" || (isTicketPayload(fData) && isFinalizedTicketState(fData));
  const isRealReopen = !stillClosed || newReopens > baselineReopens;


  if (isRealReopen) return { kind: "reopen", fData };
  return { kind: "silent", fData, silentChange: diffSilentChange(existing.raw_payload, fData) };
}

export function buildReopenUpdate(existing: FinalizedExisting, fData: any, convUpdatedAt: number) {
  return {
    lifecycle_status: "reopened_after_finalize",
    reopen_count: (existing.reopen_count || 0) + 1,
    last_reopened_at: new Date().toISOString(),
    intercom_updated_at: tsToIso(fData.updated_at) ?? tsToIso(convUpdatedAt),
    state: String(fData.state || existing.lifecycle_status),
    last_synced_at: new Date().toISOString(),
    raw_payload: fData,
  };
}

export function buildSilentNudgeUpdate(
  existing: FinalizedExisting,
  fData: any,
  silentChange: any,
  convUpdatedAt: number,
) {
  return {
    intercom_updated_at: tsToIso(fData.updated_at) ?? tsToIso(convUpdatedAt),
    last_synced_at: new Date().toISOString(),
    silent_update_count: (existing.silent_update_count || 0) + 1,
    last_silent_change: silentChange,
    raw_payload: fData,
    // keep CSAT / tags fresh since those are the most common nudges
    csat_rating: typeof fData?.conversation_rating?.rating === "number" ? fData.conversation_rating.rating : null,
    csat_remark: typeof fData?.conversation_rating?.remark === "string" && fData.conversation_rating.remark.trim()
      ? fData.conversation_rating.remark.trim()
      : null,
    csat_rated_at: tsToIso(fData?.conversation_rating?.created_at),
    tags: extractTags(fData),
  };
}

// Compare previous and current Intercom payloads on an allowlist of fields
// commonly responsible for silent `updated_at` bumps.
export function diffSilentChange(prev: any, next: any): any {
  const at = new Date().toISOString();
  const fields: string[] = [];
  const details: Record<string, any> = {};

  const prevCsat = prev?.conversation_rating?.rating ?? null;
  const nextCsat = next?.conversation_rating?.rating ?? null;
  const prevRemark = prev?.conversation_rating?.remark ?? null;
  const nextRemark = next?.conversation_rating?.remark ?? null;
  if (prevCsat !== nextCsat || prevRemark !== nextRemark) {
    fields.push("csat");
    details.csat = { from: prevCsat, to: nextCsat, remark: nextRemark || null };
  }

  const prevTags = new Set<string>(((prev?.tags?.tags || []) as any[]).map((t) => String(t?.name ?? "")).filter(Boolean));
  const nextTags = new Set<string>(((next?.tags?.tags || []) as any[]).map((t) => String(t?.name ?? "")).filter(Boolean));
  const added = [...nextTags].filter((t) => !prevTags.has(t));
  const removed = [...prevTags].filter((t) => !nextTags.has(t));
  if (added.length || removed.length) {
    fields.push("tags");
    details.tags = { added, removed };
  }

  const prevAttrs = (prev?.custom_attributes || {}) as Record<string, any>;
  const nextAttrs = (next?.custom_attributes || {}) as Record<string, any>;
  const allKeys = new Set([...Object.keys(prevAttrs), ...Object.keys(nextAttrs)]);
  const attrChanges: Record<string, { from: any; to: any }> = {};
  for (const k of allKeys) {
    const a = prevAttrs[k] ?? null;
    const b = nextAttrs[k] ?? null;
    if (JSON.stringify(a) !== JSON.stringify(b)) attrChanges[k] = { from: a, to: b };
  }
  if (Object.keys(attrChanges).length) {
    fields.push("custom_attributes");
    details.custom_attributes = attrChanges;
  }

  const prevA = String(prev?.admin_assignee_id ?? "");
  const nextA = String(next?.admin_assignee_id ?? "");
  if (prevA !== nextA) {
    fields.push("admin_assignee");
    details.admin_assignee = { from: prevA || null, to: nextA || null };
  }

  const prevParts = Number(prev?.statistics?.count_conversation_parts ?? prev?.conversation_parts?.total_count ?? 0);
  const nextParts = Number(next?.statistics?.count_conversation_parts ?? next?.conversation_parts?.total_count ?? 0);
  if (nextParts !== prevParts) {
    fields.push("conversation_parts");
    details.conversation_parts = { from: prevParts, to: nextParts };
  }

  if (!fields.length) return { at, fields: ["unknown"], details: {} };
  return { at, fields, details };
}
