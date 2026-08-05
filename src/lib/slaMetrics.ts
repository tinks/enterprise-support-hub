// SLA engine — source-agnostic, pure TypeScript.
//
// Inputs are Intercom-conversation-shaped objects (same shape as
// GET /conversations/{id} responses AND our stored raw_payload). No network,
// DB, or Intercom client access from this module.
//
// Legacy exports (`extractParts`, `computeTicketSla`, `TicketSla`,
// `sumUserToAdminGaps`, `sumUserToAdminGapsBusinessHours`) are preserved so
// the current `/sla-test` page keeps working. New code should use
// `computeSla` + `SlaResult`.

// ============================================================================
// Actor model
// ============================================================================

// Sam is our AI agent. It runs via Parahelp and posts through Intercom as a
// regular admin, so Intercom's `from_ai_agent` / `is_ai_answer` /
// `ai_agent_participated` flags are all FALSE for Sam's parts. We MUST
// identify Sam by author id/email — do not rely on those flags.
export const SAM_AUTHOR_IDS: ReadonlySet<string> = new Set([
  "9520895", // Intercom admin id for "Sam (AI agent)"
]);
export const SAM_AUTHOR_EMAILS: ReadonlySet<string> = new Set([
  "lovable@parahelp.com",
]);

// When a Lovable teammate replies in Slack, Intercom mirrors the message into
// the conversation as a part with author.type = "user" (under a contact id),
// but the email is still their internal @lovable.dev address. We must classify
// these as human_admin, not customer. Safe because @lovable.dev is our
// internal domain — a real customer can never have that email.
export const TEAMMATE_EMAIL_DOMAIN = "lovable.dev";

// Shared relay inboxes that forward CUSTOMER content in under an @lovable.dev
// address. Intercom types these parts as `user`/`lead` (never `admin`) and
// sets `waiting_since` on them — they must be treated as customer-side, never
// as our agent reply (see B6 / ticket 215475248028246). Explicit allowlist:
// every other @lovable.dev author is a real teammate.
export const SHARED_MAILBOX_EMAILS: ReadonlySet<string> = new Set([
  "enterprise-support@lovable.dev",
]);

// Intercom team id for the Enterprise Inbox — the moment a ticket becomes the
// Enterprise team's responsibility; the SLA clock-start. Everything before
// this (intake, Sam's AI handling, pre-ticket Slack/CSM chatter) is
// PRE-ENTERPRISE and reported separately as `preInboxTimeS` — never counted
// against SLA.
export const ENTERPRISE_INBOX_TEAM_ID = "8484447";

// ---- Triage discipline (PROVISIONAL, tunable) -------------------------------
// Both constants are provisional proposals, not agreed SLA targets. They exist
// so we can MEASURE the two behaviours we are re-enforcing; tune freely.
// TRIAGE_TARGET_S is on a BUSINESS-HOURS basis and should always stay <= the
// strictest First-Response target.
export const TRIAGE_TARGET_S = 1800; // 30 min, business hours
// Window before close within which a first Severity assignment is read as
// "classified at close" rather than triaged.
export const SEVERITY_AT_CLOSE_WINDOW_S = 1800; // 30 min


export type Actor =
  | "customer"
  | "shared_inbox"
  | "human_admin"
  | "sam_ai"
  | "operator_bot"
  | "system";

export function classifyActor(author: any): Actor {
  const type = String(author?.type || "").toLowerCase();
  const id = author?.id != null ? String(author.id) : "";
  const email = String(author?.email || "").toLowerCase();
  if (SAM_AUTHOR_IDS.has(id) || (email && SAM_AUTHOR_EMAILS.has(email))) return "sam_ai";
  // MUST precede the @lovable.dev → human_admin rule: that domain rule is what
  // currently mis-brands relayed customer messages as our reply.
  if (email && SHARED_MAILBOX_EMAILS.has(email)) return "shared_inbox";
  if (email.endsWith("@" + TEAMMATE_EMAIL_DOMAIN)) return "human_admin";
  if (type === "bot") return "operator_bot";
  if (type === "admin") return "human_admin";
  if (type === "user" || type === "lead" || type === "contact") return "customer";
  return "system";
}


// ============================================================================
// Timeline extraction
// ============================================================================

export type TimelinePart = {
  ts: number; // unix seconds
  actor: Actor;
  authorName: string | null;
  authorId: string | null;
  // Lowercased author email when Intercom provides one. Load-bearing for the
  // SUPPORT-roster FRT: a teammate replying in Slack is mirrored as
  // author.type = "user" under a contact id, so the email is the only reliable
  // way to attribute that reply to a support teammate.
  authorEmail: string | null;
  partType: string;
  body: string; // stripped, may be ""
  isPublicReply: boolean;
  isNote: boolean;
  assignedToType: "admin" | "team" | null;
  assignedToId: string | null;
  // Raw Intercom `event_details` for the part (Intercom-Version >= 2.13).
  // Carries attribute-change payloads such as
  // { attribute: { name: "Severity" }, value: { name: "2" }, ... }.
  // null when the part has no event_details.
  eventDetails: any | null;
};


function stripHtml(s: any): string {
  if (typeof s !== "string" || !s) return "";
  return s
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

// A part is a "public reply" when it's a customer-facing message. This mirrors
// the treatment in `supabase/functions/intercom-webhook`: a `comment` is a
// reply, and an `assignment` with non-empty body is ALSO a reply (Intercom
// sometimes emits assignment-with-body when an admin picks up + responds in
// one action). Notes, pure assignment events, workflow/attribute/state events
// are NOT public replies.
function isPublicReplyPart(partType: string, body: string): boolean {
  if (partType === "comment") return true;
  if (partType === "assignment" && body.length > 0) return true;
  return false;
}

function isNotePart(partType: string): boolean {
  return partType === "note" || partType === "note_and_reopen";
}

function readAssignmentTarget(p: any): { type: "admin" | "team" | null; id: string | null } {
  // Intercom emits assignment info on part.assigned_to = { type, id } (newer
  // shape) and sometimes on part.assignee. Handle both defensively.
  const at = p?.assigned_to ?? p?.assignee ?? null;
  if (at && typeof at === "object") {
    const t = String(at.type || "").toLowerCase();
    const id = at.id != null ? String(at.id) : null;
    if (t === "team") return { type: "team", id };
    if (t === "admin") return { type: "admin", id };
  }
  return { type: null, id: null };
}

function normalizeEmail(raw: any): string | null {

  const e = String(raw ?? "").trim().toLowerCase();
  return e ? e : null;
}


export function extractTimeline(raw: any): TimelinePart[] {
  const out: TimelinePart[] = [];
  const createdAt = raw?.created_at;
  const src = raw?.source;
  if (typeof createdAt === "number") {
    const body = stripHtml(src?.body);
    out.push({
      ts: createdAt,
      actor: src ? classifyActor(src.author) : "customer",
      authorName: src?.author?.name ?? null,
      authorId: src?.author?.id != null ? String(src.author.id) : null,
      authorEmail: normalizeEmail(src?.author?.email),

      partType: "source",
      body,
      isPublicReply: false, // the opening customer message opens the conversation, not a reply
      isNote: false,
      assignedToType: null,
      assignedToId: null,
      eventDetails: null,
    });
  }
  const arr = raw?.conversation_parts?.conversation_parts;
  if (Array.isArray(arr)) {
    for (const p of arr) {
      if (typeof p?.created_at !== "number") continue;
      const partType = String(p?.part_type || "");
      const body = stripHtml(p?.body);
      const assign = readAssignmentTarget(p);
      out.push({
        ts: p.created_at,
        actor: classifyActor(p?.author),
        authorName: p?.author?.name ?? null,
        authorId: p?.author?.id != null ? String(p.author.id) : null,
        authorEmail: normalizeEmail(p?.author?.email),

        partType,
        body,
        isPublicReply: isPublicReplyPart(partType, body),
        isNote: isNotePart(partType),
        assignedToType: assign.type,
        assignedToId: assign.id,
        eventDetails: p?.event_details ?? null,
      });
    }
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

// ============================================================================
// Business hours — Europe/Berlin, DST-aware
// ============================================================================
//
// Default window: Mon–Fri 09:00–23:59 local Berlin time (treated as
// 09:00 → 24:00 = 15h/day). Kept as module-level constants so a holiday
// calendar can slot in later without changing call sites.

export const BUSINESS_HOURS_TIMEZONE = "Europe/Berlin";
export const BUSINESS_HOURS_START_HOUR = 9;
export const BUSINESS_HOURS_END_HOUR = 24; // exclusive upper = 23:59:59.999

const berlinPartsFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: BUSINESS_HOURS_TIMEZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function berlinYMDH(ms: number): { y: number; m: number; d: number; hour: number; minute: number; second: number; dow: number } {
  const parts = berlinPartsFmt.formatToParts(new Date(ms));
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  const y = Number(map.year);
  const m = Number(map.month);
  const d = Number(map.day);
  const hour = Number(map.hour) % 24; // h23 gives 00..23
  const minute = Number(map.minute);
  const second = Number(map.second);
  // Compute day-of-week from the Berlin-local Y-M-D (treat as UTC to avoid host tz drift).
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, hour, minute, second, dow };
}

// Find the UTC ms corresponding to a given Berlin local hour on the same
// Berlin-local calendar date as `refMs`. Handles DST by iterative correction.
function berlinLocalHourToUtcMs(refMs: number, targetHour: number): number {
  const { y, m, d } = berlinYMDH(refMs);
  // First guess: pretend Berlin == UTC.
  let guess = Date.UTC(y, m - 1, d, targetHour, 0, 0, 0);
  for (let i = 0; i < 3; i++) {
    const parts = berlinYMDH(guess);
    // Delta between what Berlin thinks the wall-clock is and what we wanted.
    const wantMinutes = targetHour * 60;
    const gotMinutes = parts.hour * 60 + parts.minute;
    // Also account for date drift (if guess landed on prev/next Berlin day).
    const dateDeltaDays =
      (Date.UTC(parts.y, parts.m - 1, parts.d) - Date.UTC(y, m - 1, d)) / 86_400_000;
    const deltaMin = (dateDeltaDays * 24 * 60) + (gotMinutes - wantMinutes);
    if (deltaMin === 0) break;
    guess -= deltaMin * 60_000;
  }
  return guess;
}

export function businessHoursBetween(startSec: number, endSec: number): number {
  if (endSec <= startSec) return 0;
  const startMs = startSec * 1000;
  const endMs = endSec * 1000;
  let total = 0;

  // Walk day-by-day in Berlin local time. Cursor = the UTC ms for 00:00
  // Berlin-local of the current day.
  let cursorMs = berlinLocalHourToUtcMs(startMs, 0);
  // Safety cap — should never engage in practice.
  const MAX_ITER = 400;
  for (let i = 0; i < MAX_ITER && cursorMs < endMs; i++) {
    const { dow } = berlinYMDH(cursorMs);
    const windowStart = berlinLocalHourToUtcMs(cursorMs, BUSINESS_HOURS_START_HOUR);
    const windowEnd = berlinLocalHourToUtcMs(cursorMs, BUSINESS_HOURS_END_HOUR);
    if (dow !== 0 && dow !== 6) {
      const overlapStart = Math.max(startMs, windowStart);
      const overlapEnd = Math.min(endMs, windowEnd);
      if (overlapEnd > overlapStart) total += (overlapEnd - overlapStart) / 1000;
    }
    // Advance to next Berlin-local day. Use 25h then snap back to 00:00, to
    // absorb DST forward/back transitions.
    cursorMs = berlinLocalHourToUtcMs(cursorMs + 25 * 3600 * 1000, 0);
  }
  return Math.min(total, endSec - startSec);
}

// ============================================================================
// SLA computation
// ============================================================================

export type EscalationBasis = "team_assignment" | "marker" | "first_human" | "post_ai_handoff";

export type SlaFlags = {
  isTicket: boolean;
  samParticipated: boolean;
  noHumanReply: boolean;
  hasParts: boolean;
  noCustomerParticipant: boolean;
  // Bulk-import/manually-logged Slack thread from the Enterprise Support Hub —
  // no real reply timestamps; unmeasurable for SLA.
  manuallyLogged: boolean;
};

// ============================================================================
// Triage — Severity attribute events
// ============================================================================
//
// Intercom emits severity changes as conversation parts with
// part_type = "conversation_attribute_updated_by_admin" and
// event_details = { attribute: { name: "Severity" }, value: { name: "2" } }.
// `event_details` is only returned from Intercom-Version 2.13 onwards; 2.13
// carries the NEW value but omits `value.previous`, so the previous value is
// derived chronologically from the preceding event.

export type SeverityEvent = {
  ts: number;
  to: string | null;
  from: string | null;
  authorType: string | null;
  authorEmail: string | null;
};

export function extractSeverityEvents(timeline: TimelinePart[]): SeverityEvent[] {
  const raw: Array<SeverityEvent & { _previous: string | null }> = [];
  for (const p of timeline) {
    if (p.partType !== "conversation_attribute_updated_by_admin") continue;
    const ed = p.eventDetails;
    if (!ed || ed?.attribute?.name !== "Severity") continue;
    const toRaw = ed?.value?.name;
    const prevRaw = ed?.value?.previous;
    raw.push({
      ts: p.ts,
      to: toRaw != null ? String(toRaw) : null,
      from: null,
      authorType: p.actor ?? null,
      authorEmail: p.authorEmail ?? null,
      _previous: prevRaw != null ? String(prevRaw) : null,
    });
  }
  raw.sort((a, b) => a.ts - b.ts);
  const out: SeverityEvent[] = [];
  for (let i = 0; i < raw.length; i++) {
    const e = raw[i];
    const from = e._previous != null ? e._previous : i === 0 ? null : out[i - 1].to;
    out.push({ ts: e.ts, to: e.to, from, authorType: e.authorType, authorEmail: e.authorEmail });
  }
  return out;
}

export type TriageResult = {
  firstSeverityAtS: number | null;
  firstSeverityValue: string | null;
  timeToTriageS: number | null;
  timeToTriageBusinessHoursS: number | null;
  severityEventCount: number;
  hasSeverityEvent: boolean;
};

/**
 * MEASURE-FIRST triage metric: time from the Enterprise-Inbox anchor
 * (`slaClockStartS`) to the FIRST Severity assignment. No target, no
 * compliance. Null (not-evaluable) when there is no Severity event or no
 * anchor — never defaults to 0. Severity set BEFORE the anchor clamps to 0.
 */
export function computeTriage(
  timeline: TimelinePart[],
  slaClockStartS: number | null,
): TriageResult {
  const events = extractSeverityEvents(timeline);
  const first = events.length ? events[0] : null;
  const firstSeverityAtS = first ? first.ts : null;
  const evaluable = firstSeverityAtS != null && slaClockStartS != null;
  return {
    firstSeverityAtS,
    firstSeverityValue: first ? first.to : null,
    timeToTriageS: evaluable ? Math.max(0, firstSeverityAtS! - slaClockStartS!) : null,
    timeToTriageBusinessHoursS: evaluable
      ? firstSeverityAtS! <= slaClockStartS!
        ? 0
        : Math.max(0, businessHoursBetween(slaClockStartS!, firstSeverityAtS!))
      : null,
    severityEventCount: events.length,
    hasSeverityEvent: events.length > 0,
  };
}

// ============================================================================
// Communication cadence (Phase-1 DRUMBEAT)
// ============================================================================
// "Did we keep the customer updated often enough while the ticket was open."
// A "comm" is a PUBLIC reply by a `human_admin`. Sam (`sam_ai`), the shared
// relay inbox (`shared_inbox`), the customer, bots and notes are all EXCLUDED.
// Window = [first comm -> close]. Gaps = each consecutive comm pair, PLUS the
// tail gap (last comm -> close).
// SEMANTIC CHOICE TO CONFIRM AT HAND-WALK: the tail gap is included, so
// "went dark, then closed" counts against cadence.
// PHASE-1 DRUMBEAT: customer replies do NOT reset or pause the gap. The
// `cadenceMaxGapOverlappedCustomerWait` flag exists purely for
// interpretability — it says part of the biggest silence was customer-side.
export type CadenceResult = {
  cadenceUpdateCount: number;
  cadenceMaxGapS: number | null;
  cadenceMaxGapBusinessHoursS: number | null;
  cadenceMaxGapOverlappedCustomerWait: boolean;
  hasCadence: boolean;
};

export function computeCadence(
  timeline: TimelinePart[],
  closeAtS: number | null,
): CadenceResult {
  const comms = timeline
    .filter((p) => p.isPublicReply && p.actor === "human_admin")
    .sort((a, b) => a.ts - b.ts);

  const notEvaluable: CadenceResult = {
    cadenceUpdateCount: comms.length,
    cadenceMaxGapS: null,
    cadenceMaxGapBusinessHoursS: null,
    cadenceMaxGapOverlappedCustomerWait: false,
    hasCadence: false,
  };
  if (comms.length === 0 || closeAtS == null) return notEvaluable;

  // Gap intervals inside [first comm -> close].
  const intervals: Array<[number, number]> = [];
  for (let i = 1; i < comms.length; i++) intervals.push([comms[i - 1].ts, comms[i].ts]);
  const lastComm = comms[comms.length - 1].ts;
  if (closeAtS > lastComm) intervals.push([lastComm, closeAtS]);

  let maxStart = lastComm;
  let maxEnd = lastComm;
  let maxGap = 0;
  for (const [a, b] of intervals) {
    const g = Math.max(0, b - a);
    if (g > maxGap) {
      maxGap = g;
      maxStart = a;
      maxEnd = b;
    }
  }

  const overlappedCustomerWait = timeline.some(
    (p) => p.isPublicReply && p.actor === "customer" && p.ts > maxStart && p.ts < maxEnd,
  );

  return {
    cadenceUpdateCount: comms.length,
    cadenceMaxGapS: maxGap,
    cadenceMaxGapBusinessHoursS: Math.max(0, businessHoursBetween(maxStart, maxEnd)),
    cadenceMaxGapOverlappedCustomerWait: overlappedCustomerWait,
    hasCadence: true,
  };
}



export type SlaResult = {
  createdAtS: number | null;
  // SLA clock-start: the ts of the first assignment to the Enterprise Inbox
  // team (Intercom team id 8484447). null when the ticket never landed in the
  // Enterprise Inbox.
  enterpriseInboxAssignedAtS: number | null;
  // Effective clock-start used by all Enterprise SLA timers: the inbox anchor
  // when present, else falls back to createdAt.
  slaClockStartS: number | null;
  // Calendar seconds between ticket creation and Enterprise Inbox assignment
  // = the pre-Enterprise / Sam / pre-ticket window. Reported as a process
  // health signal, NEVER counted against the SLA. null when there is no
  // inbox assignment.
  preInboxTimeS: number | null;
  firstResponseAnyAgentS: number | null;
  firstResponseAnyAgentBusinessHoursS: number | null;
  timeToEscalationS: number | null;
  timeToEscalationBusinessHoursS: number | null;
  escalationTs: number | null;
  escalationBasis: EscalationBasis | null;
  firstHumanReplyFromEscalationS: number | null;
  firstHumanReplyFromEscalationBusinessHoursS: number | null;
  firstHumanReplyFromOpenS: number | null;
  firstHumanReplyFromOpenBusinessHoursS: number | null;
  // Anchored FRT: first HUMAN reply at/after the SLA clock-start (Enterprise
  // Inbox assignment, or createdAt fallback). This is what evaluateCompliance
  // now uses for First Response. Replies BEFORE the anchor are ignored.
  firstHumanReplyFromInboxS: number | null;
  firstHumanReplyFromInboxBusinessHoursS: number | null;
  // SUPPORT-based FRT (commit 2). The first PUBLIC reply by a support-roster
  // teammate ANYWHERE in the thread, measured from the Enterprise Inbox anchor
  // and CLAMPED at 0: support answering BEFORE the ticket reached the inbox is
  // a met SLA (zero wait), not an un-measurable event. Only support counts —
  // Sam (role='ai') and bots never satisfy First Response.
  // `firstSupportReplyS` is the absolute unix ts of that reply.
  firstSupportReplyS: number | null;
  firstSupportReplyFromInboxS: number | null;
  firstSupportReplyFromInboxBusinessHoursS: number | null;
  // Work-Before-Ticket (commit 3) — the MIRROR of the clamped FRT:
  // max(0, slaClockStartS - firstSupportReplyS). Time Support was already
  // working the issue BEFORE it existed as a ticket in the Enterprise Inbox.
  // Only one of FRT / WBT is ever > 0. This is the Tenet #1 ("no work without
  // a ticket") process signal — NOT an SLA breach. Distinct from
  // `preInboxTimeS`, which is the customer's total pre-inbox wait.
  workBeforeTicketS: number | null;
  workBeforeTicketBusinessHoursS: number | null;

  ttrS: number | null;
  ttrBusinessHoursS: number | null;
  // Stop-the-clock resolution: active in-our-court time from the SLA
  // clock-start (Enterprise Inbox anchor, else createdAt) to last close,
  // EXCLUDING intervals awaiting the customer (and thus naturally excluding
  // closed-then-reopened gaps). Null when open/close not known.
  resolutionActiveS: number | null;
  resolutionActiveBusinessHoursS: number | null;
  reopenCount: number;
  handlingTimeS: number;
  handlingTimeBusinessHoursS: number;
  partsCount: number;
  // Triage (measure-first): time from the SLA anchor to the first Severity
  // assignment. See computeTriage.
  firstSeverityAtS: number | null;
  firstSeverityValue: string | null;
  timeToTriageS: number | null;
  timeToTriageBusinessHoursS: number | null;
  severityEventCount: number;
  hasSeverityEvent: boolean;
  // ---- Triage discipline flags (provisional target, see TRIAGE_TARGET_S) ----
  // Business-hours triage exceeded the provisional 30-min target. Rows that are
  // not evaluable (no Severity event / no anchor) are NEVER violations.
  triageViolation: boolean;
  // A human teammate publicly replied before any Severity was assigned. Sam and
  // the shared relay inbox are excluded so an instant AI reply cannot trip this.
  answeredBeforeClassified: boolean;
  // First Severity assignment landed within SEVERITY_AT_CLOSE_WINDOW_S of close
  // — the "classified at close" bookkeeping pattern.
  severityRecordedAtClose: boolean;

  flags: SlaFlags;
  // Who opened the conversation. "agent" means WE opened it (teammate outreach,
  // CSM relay, forwarded email, or Sam). "customer" means an external party
  // opened it. Anti-masking: customer/operator_bot/system/unknown all default
  // to "customer" so we never silently drop a ticket out of First Response;
  // we only pull OUT tickets whose opener is clearly our side. Known
  // limitation: a forwarded customer email whose source author is our shared
  // inbox (@lovable.dev) will classify as "agent" — accepted for now, to be
  // correctable via a future manual override.
  initiatedBy: "customer" | "agent";
  timeline: TimelinePart[];
};

function detectEscalation(timeline: TimelinePart[]): { ts: number; basis: EscalationBasis } | null {
  // Anchor on the post-AI human handoff. The initial routing team-assignment
  // (typically at +1s, before Sam even replies) MUST be ignored.
  const firstSamReplyTs =
    timeline.find((p) => p.isPublicReply && p.actor === "sam_ai")?.ts ?? null;

  let markerTs: number | null = null;
  for (const p of timeline) {
    const b = p.body.toLowerCase();
    if (b.includes("escalated") && b.includes("awaiting human")) {
      markerTs = p.ts;
      break;
    }
  }

  let postAiHandoffTs: number | null = null;
  if (firstSamReplyTs != null) {
    for (const p of timeline) {
      if (p.assignedToType === "team" && p.ts >= firstSamReplyTs) {
        postAiHandoffTs = p.ts;
        break;
      }
    }
  }

  const handoff: Array<{ ts: number; basis: EscalationBasis }> = [];
  if (markerTs != null) handoff.push({ ts: markerTs, basis: "marker" });
  if (postAiHandoffTs != null) handoff.push({ ts: postAiHandoffTs, basis: "post_ai_handoff" });
  if (handoff.length) {
    handoff.sort((a, b) => a.ts - b.ts);
    return handoff[0];
  }

  // Fallbacks — only when there was no AI turn / no handoff signal.
  const teamAssign = timeline.find((p) => p.assignedToType === "team");
  if (teamAssign) return { ts: teamAssign.ts, basis: "team_assignment" };
  const firstHuman = timeline.find((p) => p.isPublicReply && p.actor === "human_admin");
  if (firstHuman) return { ts: firstHuman.ts, basis: "first_human" };
  return null;
}

// Sum of customer-wait gaps. A gap OPENS on the first unanswered customer
// message and CLOSES on the next public reply by human_admin OR sam_ai
// (operator_bot / system don't clear the gap).
function sumCustomerWaitGaps(timeline: TimelinePart[], clip: (a: number, b: number) => number): number {
  let total = 0;
  let pending: number | null = null;
  for (const p of timeline) {
    if (p.actor === "customer" || p.actor === "shared_inbox") {
      // Both source and later customer messages open the pending clock.
      if (pending == null) pending = p.ts;
    } else if (p.isPublicReply && (p.actor === "human_admin" || p.actor === "sam_ai")) {
      if (pending != null) {
        total += clip(pending, p.ts);
        pending = null;
      }
    }
  }
  return total;
}

/**
 * Support roster, passed IN by the caller. The engine stays pure — it never
 * queries `teammates` itself. Emails are matched lowercased (catches
 * Slack-mirrored replies Intercom emits as author.type='user'); admin ids
 * catch native Intercom-admin replies.
 *
 * BACKWARD-COMPAT: when omitted (or both sets empty), any `human_admin` public
 * reply counts as support — i.e. the pre-commit-2 behavior.
 */
export type SlaComputeOptions = {
  supportEmails?: Set<string>;
  supportAdminIds?: Set<string>;
};

export function computeSla(conversation: any, opts?: SlaComputeOptions): SlaResult {

  const timeline = extractTimeline(conversation);
  const createdAt: number | null =
    typeof conversation?.created_at === "number" ? conversation.created_at : null;

  // SLA clock-start = first Enterprise Inbox team assignment; else createdAt.
  const enterpriseInboxAssignment = timeline.find(
    (p) => p.assignedToType === "team" && p.assignedToId === ENTERPRISE_INBOX_TEAM_ID,
  );
  const enterpriseInboxAssignedAtS: number | null = enterpriseInboxAssignment?.ts ?? null;
  const slaClockStartS: number | null =
    enterpriseInboxAssignedAtS != null ? enterpriseInboxAssignedAtS : createdAt;
  const preInboxTimeS: number | null =
    enterpriseInboxAssignedAtS != null && createdAt != null
      ? Math.max(0, enterpriseInboxAssignedAtS - createdAt)
      : null;

  const firstAnyAgentReply = timeline.find(
    (p) => p.isPublicReply && (p.actor === "human_admin" || p.actor === "sam_ai"),
  );
  const firstHumanReply = timeline.find(
    (p) => p.isPublicReply && p.actor === "human_admin",
  );
  // Anchored: first human reply AT/AFTER the SLA clock-start. Replies before
  // the Enterprise Inbox assignment (e.g., Sam or a teammate during intake)
  // are ignored — the Enterprise SLA clock hasn't started yet.
  const firstHumanReplyAfterInbox =
    slaClockStartS != null
      ? timeline.find(
          (p) => p.isPublicReply && p.actor === "human_admin" && p.ts >= slaClockStartS,
        )
      : undefined;
  const firstHumanReplyFromInboxS =
    firstHumanReplyAfterInbox && slaClockStartS != null
      ? Math.max(0, firstHumanReplyAfterInbox.ts - slaClockStartS)
      : null;
  const firstHumanReplyFromInboxBusinessHoursS =
    firstHumanReplyAfterInbox && slaClockStartS != null
      ? businessHoursBetween(slaClockStartS, firstHumanReplyAfterInbox.ts)
      : null;

  // ---- SUPPORT-based FRT (commit 2) ----------------------------------------
  // A = ts of the FIRST support public reply ANYWHERE in the thread (not
  // restricted to post-anchor). B = slaClockStartS. FRT = max(0, A - B):
  // support answering before the ticket hit the inbox means zero wait → MET.
  const supportEmails = opts?.supportEmails;
  const supportAdminIds = opts?.supportAdminIds;
  const hasRoster = !!((supportEmails?.size ?? 0) + (supportAdminIds?.size ?? 0));
  const isSupportPart = (p: TimelinePart): boolean => {
    if (!p.isPublicReply) return false;
    // No roster supplied → pre-commit-2 fallback: any human_admin reply.
    if (!hasRoster) return p.actor === "human_admin";
    // Sam is role='ai' → never in the roster → correctly excluded.
    if (p.authorEmail && supportEmails?.has(p.authorEmail)) return true;
    if (p.authorId && supportAdminIds?.has(p.authorId)) return true;
    return false;
  };
  const firstSupportReply = timeline.find(isSupportPart);
  const firstSupportReplyS = firstSupportReply?.ts ?? null;
  const firstSupportReplyFromInboxS =
    firstSupportReply && slaClockStartS != null
      ? Math.max(0, firstSupportReply.ts - slaClockStartS)
      : null;
  const firstSupportReplyFromInboxBusinessHoursS =
    firstSupportReply && slaClockStartS != null
      ? firstSupportReply.ts <= slaClockStartS
        ? 0
        : businessHoursBetween(slaClockStartS, firstSupportReply.ts)
      : null;

  // Work-Before-Ticket — mirror of the clamped FRT above.
  const workBeforeTicketS =
    firstSupportReplyS != null && slaClockStartS != null
      ? Math.max(0, slaClockStartS - firstSupportReplyS)
      : null;
  const workBeforeTicketBusinessHoursS =
    firstSupportReplyS != null && slaClockStartS != null
      ? firstSupportReplyS >= slaClockStartS
        ? 0
        : businessHoursBetween(firstSupportReplyS, slaClockStartS)
      : null;



  const escalation = detectEscalation(timeline);

  const firstResponseAnyAgentS =
    firstAnyAgentReply && createdAt != null ? Math.max(0, firstAnyAgentReply.ts - createdAt) : null;
  const firstHumanReplyFromOpenS =
    firstHumanReply && createdAt != null ? Math.max(0, firstHumanReply.ts - createdAt) : null;
  const timeToEscalationS =
    escalation && createdAt != null ? Math.max(0, escalation.ts - createdAt) : null;

  let firstHumanReplyFromEscalationS: number | null = null;
  if (escalation && firstHumanReply && firstHumanReply.ts >= escalation.ts) {
    firstHumanReplyFromEscalationS = firstHumanReply.ts - escalation.ts;
  }

  // Business-hours parallels — same guards as calendar counterparts.
  const firstResponseAnyAgentBusinessHoursS =
    firstAnyAgentReply && createdAt != null ? businessHoursBetween(createdAt, firstAnyAgentReply.ts) : null;
  const firstHumanReplyFromOpenBusinessHoursS =
    firstHumanReply && createdAt != null ? businessHoursBetween(createdAt, firstHumanReply.ts) : null;
  const timeToEscalationBusinessHoursS =
    escalation && createdAt != null ? businessHoursBetween(createdAt, escalation.ts) : null;
  const firstHumanReplyFromEscalationBusinessHoursS =
    escalation && firstHumanReply && firstHumanReply.ts >= escalation.ts
      ? businessHoursBetween(escalation.ts, firstHumanReply.ts)
      : null;

  const stats = conversation?.statistics ?? {};
  const ttrS = typeof stats.time_to_last_close === "number" ? stats.time_to_last_close : null;
  const reopenCount = typeof stats.count_reopens === "number" ? stats.count_reopens : 0;

  // TTR business-hours — computed from close timestamp (last_close_at preferred,
  // else first_close_at). `time_to_last_close` is a calendar-second duration
  // and cannot be re-clipped to business hours after the fact.
  const closeAt: number | null =
    typeof stats.last_close_at === "number"
      ? stats.last_close_at
      : typeof stats.first_close_at === "number"
        ? stats.first_close_at
        : null;
  const ttrBusinessHoursS =
    closeAt != null && createdAt != null ? businessHoursBetween(createdAt, closeAt) : null;

  const handlingTimeS = sumCustomerWaitGaps(timeline, (a, b) => Math.max(0, b - a));
  const handlingTimeBusinessHoursS = sumCustomerWaitGaps(timeline, (a, b) => businessHoursBetween(a, b));

  // Stop-the-clock resolution — active in-our-court time from the SLA
  // clock-start (Enterprise Inbox anchor, else createdAt) to last close.
  // Timeline parts BEFORE the anchor are ignored — pre-inbox / Sam handling
  // must not count against Enterprise SLA.
  function computeResolutionActive(clip: (a: number, b: number) => number): number | null {
    if (slaClockStartS == null || closeAt == null) return null;
    if (closeAt < slaClockStartS) return 0;
    let total = 0;
    let ballWithUs = true;
    let segStart = slaClockStartS;
    for (const p of timeline) {
      if (p.ts < slaClockStartS || p.ts > closeAt) continue;
      // A close STOPS the resolution clock — the ball is no longer ours once the
      // ticket is closed. A later customer message / reopen starts a fresh
      // in-our-court segment via the customer branch below. Without this, a close
      // that follows the customer's last word ("thanks!" → close with no reply
      // after) left the ball "with us"; if the ticket was later reopened,
      // last_close jumped forward and the whole dormant gap was wrongly counted as
      // active resolution time (phantom breach).
      if (p.partType === "close") {
        if (ballWithUs) {
          total += clip(segStart, p.ts);
          ballWithUs = false;
        }
        continue;
      }
      // `shared_inbox` is a relay forwarding CUSTOMER content — it RETURNS the
      // ball to us, exactly like a direct customer reply (mirrors Intercom's
      // own `waiting_since` behavior). See B6.
      if (p.actor === "customer" || p.actor === "shared_inbox") {
        if (!ballWithUs) {
          ballWithUs = true;
          segStart = p.ts;
        }

      } else if (p.isPublicReply && (p.actor === "human_admin" || p.actor === "sam_ai")) {
        if (ballWithUs) {
          total += clip(segStart, p.ts);
          ballWithUs = false;
        }
      }
    }
    if (ballWithUs) total += clip(segStart, closeAt);
    return total;
  }
  const resolutionActiveS = computeResolutionActive((a, b) => Math.max(0, b - a));
  const resolutionActiveBusinessHoursS = computeResolutionActive((a, b) => businessHoursBetween(a, b));

  const samParticipated = timeline.some((p) => p.isPublicReply && p.actor === "sam_ai");
  const noHumanReply = !firstHumanReply;
  const noCustomerParticipant = !timeline.some(
    (p) => p.actor === "customer" || p.actor === "shared_inbox",
  );

  // Manually-logged bulk-import Slack thread — signature body from the
  // Enterprise Support Hub import path. Unmeasurable for SLA.
  const sourceBodyStripped = stripHtml(conversation?.source?.body);
  const manuallyLogged = /manually logged slack_thread/i.test(sourceBodyStripped);

  // Initiation classification — see SlaResult.initiatedBy for rationale.
  const sourceAuthor = conversation?.source?.author;
  let sourceActor: Actor;
  if (sourceAuthor) {
    sourceActor = classifyActor(sourceAuthor);
  } else if (timeline.length > 0) {
    sourceActor = timeline[0].actor;
  } else {
    sourceActor = "customer";
  }
  const initiatedBy: "customer" | "agent" =
    sourceActor === "human_admin" || sourceActor === "sam_ai" ? "agent" : "customer";

  const triage = computeTriage(timeline, slaClockStartS);

  // ---- Triage discipline flags (provisional targets) -----------------------
  const triageViolation =
    triage.hasSeverityEvent &&
    triage.timeToTriageBusinessHoursS != null &&
    triage.timeToTriageBusinessHoursS > TRIAGE_TARGET_S;
  // `firstHumanReply` is the first PUBLIC reply by a human_admin — Sam (sam_ai)
  // and the shared relay inbox (shared_inbox) are separate actors and excluded.
  const answeredBeforeClassified =
    !!firstHumanReply &&
    triage.firstSeverityAtS != null &&
    firstHumanReply.ts < triage.firstSeverityAtS;
  const severityRecordedAtClose =
    triage.firstSeverityAtS != null &&
    closeAt != null &&
    triage.firstSeverityAtS <= closeAt &&
    closeAt - triage.firstSeverityAtS <= SEVERITY_AT_CLOSE_WINDOW_S;


  return {
    createdAtS: createdAt,
    enterpriseInboxAssignedAtS,
    slaClockStartS,
    preInboxTimeS,
    firstResponseAnyAgentS,
    firstResponseAnyAgentBusinessHoursS,
    timeToEscalationS,
    timeToEscalationBusinessHoursS,
    escalationTs: escalation?.ts ?? null,
    escalationBasis: escalation?.basis ?? null,
    firstHumanReplyFromEscalationS,
    firstHumanReplyFromEscalationBusinessHoursS,
    firstHumanReplyFromOpenS,
    firstHumanReplyFromOpenBusinessHoursS,
    firstHumanReplyFromInboxS,
    firstHumanReplyFromInboxBusinessHoursS,
    firstSupportReplyS,
    firstSupportReplyFromInboxS,
    firstSupportReplyFromInboxBusinessHoursS,
    workBeforeTicketS,
    workBeforeTicketBusinessHoursS,

    ttrS,
    ttrBusinessHoursS,
    resolutionActiveS,
    resolutionActiveBusinessHoursS,
    reopenCount,
    handlingTimeS,
    handlingTimeBusinessHoursS,
    partsCount: timeline.length,
    ...triage,
    triageViolation,
    answeredBeforeClassified,
    severityRecordedAtClose,

    flags: {
      isTicket: !!conversation?.ticket,
      samParticipated,
      noHumanReply,
      hasParts: timeline.length > 0,
      noCustomerParticipant,
      manuallyLogged,
    },
    initiatedBy,
    timeline,
  };
}

// ============================================================================
// Aggregate
// ============================================================================

export type AggregateResult = {
  avg: number | null;
  median: number | null;
  p90: number | null;
  p95: number | null;
  n: number;
  nNull: number;
};

export function aggregate(values: Array<number | null | undefined>): AggregateResult {
  let nNull = 0;
  const clean: number[] = [];
  for (const v of values) {
    if (typeof v === "number" && isFinite(v) && v > 0) clean.push(v);
    else nNull++;
  }
  if (!clean.length) return { avg: null, median: null, p90: null, p95: null, n: 0, nNull };
  const sorted = [...clean].sort((a, b) => a - b);
  const avg = clean.reduce((a, b) => a + b, 0) / clean.length;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const quantile = (q: number) => {
    const rank = q * (sorted.length - 1);
    const lo = Math.floor(rank);
    const hi = Math.ceil(rank);
    return lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
  };
  return { avg, median, p90: quantile(0.9), p95: quantile(0.95), n: clean.length, nNull };
}

// ============================================================================
// Origin detection — best-effort heuristic
// ============================================================================
// Classifies where a conversation was originated from. Best-effort:
//  - "slack": custom_attributes["Slack channel"] set, OR any part has an
//    external_id starting with "slack:".
//  - "email": source looks email-delivered — source.type === "email", OR
//    source.delivered_as === "customer_initiated" with an author email, OR
//    a subject line is present on the source.
//  - "other": everything else (in-app messenger, API, etc.).
export type Origin = "slack" | "email" | "other";

export function detectOrigin(conversation: any): Origin {
  const attrs = conversation?.custom_attributes ?? {};
  if (attrs && typeof attrs === "object" && attrs["Slack channel"]) return "slack";
  const parts = conversation?.conversation_parts?.conversation_parts;
  if (Array.isArray(parts)) {
    for (const p of parts) {
      const ext = p?.external_id;
      if (typeof ext === "string" && ext.startsWith("slack:")) return "slack";
    }
  }
  const src = conversation?.source ?? {};
  const srcType = String(src?.type || "").toLowerCase();
  if (srcType === "email") return "email";
  const deliveredAs = String(src?.delivered_as || "").toLowerCase();
  if (deliveredAs.includes("email")) return "email";
  if (src?.subject && typeof src.subject === "string" && src.subject.trim().length > 0) {
    // Intercom sets a subject on email-originated conversations; messenger
    // convos generally lack one. Weak signal but useful as a tiebreak.
    return "email";
  }
  return "other";
}


// ============================================================================
// Formatting
// ============================================================================

export function formatDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h < 24) return `${h}h ${rem}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

// Same as formatDuration for sub-day values, but renders the day unit as
// BUSINESS DAYS (BUSINESS_DAY_SECONDS = 15h) so business-hours targets like
// "2 business days" don't display as "1d 6h" via 24h days.
export function formatBusinessDuration(seconds: number | null): string {
  if (seconds == null) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.round(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  const businessDayHours = BUSINESS_DAY_SECONDS / 3600; // 15
  if (h < businessDayHours) return `${h}h ${rem}m`;
  const bd = Math.floor(h / businessDayHours);
  const remH = h % businessDayHours;
  return remH === 0 ? `${bd}bd` : `${bd}bd ${remH}h`;
}


// ============================================================================
// Legacy exports — preserved so `/sla-test` keeps building.
// New callers should use `computeSla` / `TimelinePart` / `SlaResult`.
// ============================================================================

export type Part = {
  ts: number;
  authorType: "user" | "admin" | "bot" | "other";
  partType: string;
};

function actorToLegacyAuthorType(actor: Actor): Part["authorType"] {
  // shared_inbox is customer-side (relayed customer content) → "user".
  if (actor === "customer" || actor === "shared_inbox") return "user";
  if (actor === "human_admin" || actor === "sam_ai") return "admin";
  if (actor === "operator_bot") return "bot";
  return "other";
}

const LEGACY_VISIBLE_PART_TYPES = new Set([
  "comment",
  "close",
  "open",
  "assign_and_reopen",
  "away_mode_assignment",
  "default_assignment",
  "conversation_attribute_updated_by_workflow",
]);

// Legacy: keeps prior visibility filter (drops notes and pure assignment events)
// so existing counts on /sla-test don't shift under this refactor.
export function extractParts(raw: any): Part[] {
  return extractTimeline(raw)
    .filter((p) => {
      if (p.partType === "source") return true;
      if (p.isNote) return false;
      if (p.partType === "assignment") return false;
      return LEGACY_VISIBLE_PART_TYPES.has(p.partType) || p.partType.includes("comment");
    })
    .map((p) => ({ ts: p.ts, authorType: actorToLegacyAuthorType(p.actor), partType: p.partType }));
}

export function sumUserToAdminGaps(parts: Part[]): number {
  let total = 0;
  let pendingUser: number | null = null;
  for (const p of parts) {
    if (p.authorType === "user") {
      if (pendingUser == null) pendingUser = p.ts;
    } else if (p.authorType === "admin" || p.authorType === "bot") {
      if (pendingUser != null) {
        total += Math.max(0, p.ts - pendingUser);
        pendingUser = null;
      }
    }
  }
  return total;
}

export function sumUserToAdminGapsBusinessHours(parts: Part[]): number {
  let total = 0;
  let pendingUser: number | null = null;
  for (const p of parts) {
    if (p.authorType === "user") {
      if (pendingUser == null) pendingUser = p.ts;
    } else if (p.authorType === "admin" || p.authorType === "bot") {
      if (pendingUser != null) {
        total += businessHoursBetween(pendingUser, p.ts);
        pendingUser = null;
      }
    }
  }
  return total;
}

export type TicketSla = {
  firstAdminReplyS: number | null;
  rawResolveS: number | null;
  responseGapSumS: number;
  businessHoursHandlingS: number;
  partsCount: number;
};

export function computeTicketSla(row: {
  raw_payload: any;
  time_to_resolve_s: number | null;
  time_to_first_admin_reply_s?: number | null;
  intercom_created_at?: string | null;
}): TicketSla {
  const parts = extractParts(row.raw_payload);
  const firstAdmin = parts.find((p) => p.authorType === "admin" || p.authorType === "bot");
  const createdAt = row?.raw_payload?.created_at as number | undefined;
  const firstAdminReplyS =
    typeof row.time_to_first_admin_reply_s === "number"
      ? row.time_to_first_admin_reply_s
      : firstAdmin && typeof createdAt === "number"
        ? Math.max(0, firstAdmin.ts - createdAt)
        : null;
  return {
    firstAdminReplyS,
    rawResolveS: row.time_to_resolve_s ?? null,
    responseGapSumS: sumUserToAdminGaps(parts),
    businessHoursHandlingS: sumUserToAdminGapsBusinessHours(parts),
    partsCount: parts.length,
  };
}

// ============================================================================
// SLA compliance targets
// ============================================================================
//
// PROPOSED, provisional per-severity SLA targets. This is the single source of
// truth for target numbers — edit HERE if the numbers change.
//
// Business day = the size of the existing business-hours window (Mon–Fri
// 09:00–24:00 Europe/Berlin) = 15h = 54000s. Derived, not hardcoded, so tests
// stay honest if we tighten the window later.

export const BUSINESS_DAY_SECONDS =
  (BUSINESS_HOURS_END_HOUR - BUSINESS_HOURS_START_HOUR) * 3600;

export type SlaClock = "calendar" | "business";
export type Severity = 1 | 2 | 3 | 4;

export type SlaTarget = {
  firstResponseS: number;
  firstResponseClock: SlaClock;
  resolutionS: number | null; // null = no committed resolution (Sev 4)
  resolutionClock: SlaClock;
  // Cadence-ready: optional per-severity update cadence (Sev1/Sev2 in practice).
  // NOT consumed by evaluateCompliance yet — structure only, for the what-if slider.
  cadence?: { updateEveryS: number; clock: SlaClock };
};

// Injectable target set. Defaults to SLA_TARGETS everywhere; a what-if surface
// can pass a modified copy to recompute compliance WITHOUT duplicating rules.
export type SlaTargets = Record<Severity, SlaTarget>;


// Single source of truth for proposed SLA targets — edit HERE if the numbers change.
export const SLA_TARGETS: SlaTargets = {
  // Sev 1 runs on wall-clock 24/7 (pending Development off-hours-coverage buy-in).
  1: { firstResponseS: 30 * 60,             firstResponseClock: "calendar", resolutionS: 8 * 3600,                 resolutionClock: "calendar" },
  2: { firstResponseS: 4 * 3600,            firstResponseClock: "business", resolutionS: 2 * BUSINESS_DAY_SECONDS, resolutionClock: "business" },
  3: { firstResponseS: 1 * BUSINESS_DAY_SECONDS, firstResponseClock: "business", resolutionS: 5 * BUSINESS_DAY_SECONDS, resolutionClock: "business" },
  // Sev 4: best-effort, no committed resolution time.
  4: { firstResponseS: 3 * BUSINESS_DAY_SECONDS, firstResponseClock: "business", resolutionS: null,                    resolutionClock: "business" },
};

// Parse the Intercom "Severity" custom-attribute value. CRITICAL: never default
// an unknown/missing value to a severity — return null so callers can surface
// it as "unclassified".
export function parseSeverity(raw: unknown): Severity | null {
  if (raw == null) return null;
  if (typeof raw === "number") {
    if (raw === 1 || raw === 2 || raw === 3 || raw === 4) return raw;
    return null;
  }
  if (typeof raw === "string") {
    const s = raw.trim();
    if (!s) return null;
    const n = Number(s);
    if (n === 1 || n === 2 || n === 3 || n === 4) return n as Severity;
    return null;
  }
  return null;
}

export type ComplianceVerdict = {
  value: number | null;
  target: number | null;
  clock: SlaClock;
  met: boolean | null; // null = NOT EVALUABLE (no measurement, or no committed target)
};

export type SlaCompliance = {
  severity: Severity;
  firstResponse: ComplianceVerdict;
  resolution: ComplianceVerdict;
};

export function evaluateCompliance(
  sla: SlaResult,
  severity: Severity,
  targets: SlaTargets = SLA_TARGETS,
): SlaCompliance {
  const target = targets[severity];

  // First Response = first PUBLIC reply by a SUPPORT-roster teammate (Sam and
  // bots excluded), measured from the SLA clock-start (Enterprise Inbox
  // assignment, else createdAt) and CLAMPED at 0. A support reply that landed
  // BEFORE the anchor means the customer never waited on the Enterprise queue
  // → FRT 0 → MET, rather than being dropped as un-measurable.
  // RESOLUTION LOGIC BELOW IS UNCHANGED.
  const frValue =
    target.firstResponseClock === "business"
      ? sla.firstSupportReplyFromInboxBusinessHoursS
      : sla.firstSupportReplyFromInboxS;

  const firstResponse: ComplianceVerdict = {
    value: frValue,
    target: target.firstResponseS,
    clock: target.firstResponseClock,
    met: frValue == null ? null : frValue <= target.firstResponseS,
  };

  // Resolution → stop-the-clock active in-our-court time (not raw TTR). Sev4
  // has no committed resolution → met stays null.
  const resValue =
    target.resolutionClock === "business"
      ? sla.resolutionActiveBusinessHoursS
      : sla.resolutionActiveS;
  const resolution: ComplianceVerdict = {
    value: resValue,
    target: target.resolutionS,
    clock: target.resolutionClock,
    met:
      target.resolutionS == null
        ? null
        : resValue == null
          ? null
          : resValue <= target.resolutionS,
  };

  return { severity, firstResponse, resolution };
}

// Triage compliance against an INJECTABLE target (business-hours basis, matching
// the triage headline). null = NOT EVALUABLE (no Severity event / no anchor) —
// absence of data is never scored as a miss.
export function evaluateTriage(sla: SlaResult, triageTargetS: number): boolean | null {
  if (!sla.hasSeverityEvent) return null;
  if (sla.timeToTriageBusinessHoursS == null) return null;
  return sla.timeToTriageBusinessHoursS <= triageTargetS;
}
