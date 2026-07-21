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

// Intercom team id for the Enterprise Inbox — the moment a ticket becomes the
// Enterprise team's responsibility; the SLA clock-start. Everything before
// this (intake, Sam's AI handling, pre-ticket Slack/CSM chatter) is
// PRE-ENTERPRISE and reported separately as `preInboxTimeS` — never counted
// against SLA.
export const ENTERPRISE_INBOX_TEAM_ID = "8484447";

export type Actor =
  | "customer"
  | "human_admin"
  | "sam_ai"
  | "operator_bot"
  | "system";

function classifyActor(author: any): Actor {
  const type = String(author?.type || "").toLowerCase();
  const id = author?.id != null ? String(author.id) : "";
  const email = String(author?.email || "").toLowerCase();
  if (SAM_AUTHOR_IDS.has(id) || (email && SAM_AUTHOR_EMAILS.has(email))) return "sam_ai";
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
  partType: string;
  body: string; // stripped, may be ""
  isPublicReply: boolean;
  isNote: boolean;
  assignedToType: "admin" | "team" | null;
  assignedToId: string | null;
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
      partType: "source",
      body,
      isPublicReply: false, // the opening customer message opens the conversation, not a reply
      isNote: false,
      assignedToType: null,
      assignedToId: null,
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
        partType,
        body,
        isPublicReply: isPublicReplyPart(partType, body),
        isNote: isNotePart(partType),
        assignedToType: assign.type,
        assignedToId: assign.id,
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
    if (p.actor === "customer") {
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

export function computeSla(conversation: any): SlaResult {
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

  // Stop-the-clock resolution — active in-our-court time from open to last close.
  function computeResolutionActive(clip: (a: number, b: number) => number): number | null {
    if (createdAt == null || closeAt == null) return null;
    let total = 0;
    let ballWithUs = true;
    let segStart = createdAt;
    for (const p of timeline) {
      if (p.ts < createdAt || p.ts > closeAt) continue;
      if (p.actor === "customer") {
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
  const noCustomerParticipant = !timeline.some((p) => p.actor === "customer");

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

  return {
    createdAtS: createdAt,
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
    ttrS,
    ttrBusinessHoursS,
    resolutionActiveS,
    resolutionActiveBusinessHoursS,
    reopenCount,
    handlingTimeS,
    handlingTimeBusinessHoursS,
    partsCount: timeline.length,
    flags: {
      isTicket: !!conversation?.ticket,
      samParticipated,
      noHumanReply,
      hasParts: timeline.length > 0,
      noCustomerParticipant,
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
  if (actor === "customer") return "user";
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
};

// Single source of truth for proposed SLA targets — edit HERE if the numbers change.
export const SLA_TARGETS: Record<Severity, SlaTarget> = {
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

export function evaluateCompliance(sla: SlaResult, severity: Severity): SlaCompliance {
  const target = SLA_TARGETS[severity];

  // First Response = first HUMAN engineer reply (bots/Sam excluded).
  // For AI-handled tickets (Sam replied, then handed off to a human), the
  // human's clock starts at the AI→human handoff — not at ticket open. For
  // direct-to-human or non-handoff bases (team_assignment / first_human) we
  // keep measuring from open.
  const useFromEscalation =
    (sla.escalationBasis === "post_ai_handoff" || sla.escalationBasis === "marker") &&
    (target.firstResponseClock === "business"
      ? sla.firstHumanReplyFromEscalationBusinessHoursS != null
      : sla.firstHumanReplyFromEscalationS != null);

  const frValue = useFromEscalation
    ? target.firstResponseClock === "business"
      ? sla.firstHumanReplyFromEscalationBusinessHoursS
      : sla.firstHumanReplyFromEscalationS
    : target.firstResponseClock === "business"
      ? sla.firstHumanReplyFromOpenBusinessHoursS
      : sla.firstHumanReplyFromOpenS;
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

