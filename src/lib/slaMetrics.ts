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
};

export type SlaResult = {
  createdAtS: number | null;
  firstResponseAnyAgentS: number | null;
  timeToEscalationS: number | null;
  escalationTs: number | null;
  escalationBasis: EscalationBasis | null;
  firstHumanReplyFromEscalationS: number | null;
  firstHumanReplyFromOpenS: number | null;
  ttrS: number | null;
  reopenCount: number;
  handlingTimeS: number;
  handlingTimeBusinessHoursS: number;
  partsCount: number;
  flags: SlaFlags;
  timeline: TimelinePart[];
};

function detectEscalation(timeline: TimelinePart[]): { ts: number; basis: EscalationBasis } | null {
  let teamAssignTs: number | null = null;
  let markerTs: number | null = null;
  let firstHumanTs: number | null = null;
  for (const p of timeline) {
    if (teamAssignTs == null && p.assignedToType === "team") teamAssignTs = p.ts;
    if (markerTs == null) {
      const b = p.body.toLowerCase();
      if (b.includes("escalated") && b.includes("awaiting human")) markerTs = p.ts;
    }
    if (firstHumanTs == null && p.isPublicReply && p.actor === "human_admin") firstHumanTs = p.ts;
  }
  const candidates: Array<{ ts: number; basis: EscalationBasis }> = [];
  if (teamAssignTs != null) candidates.push({ ts: teamAssignTs, basis: "team_assignment" });
  if (markerTs != null) candidates.push({ ts: markerTs, basis: "marker" });
  if (firstHumanTs != null) candidates.push({ ts: firstHumanTs, basis: "first_human" });
  if (!candidates.length) return null;
  candidates.sort((a, b) => a.ts - b.ts);
  return candidates[0];
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

  const firstAnyAgentReply = timeline.find(
    (p) => p.isPublicReply && (p.actor === "human_admin" || p.actor === "sam_ai"),
  );
  const firstHumanReply = timeline.find(
    (p) => p.isPublicReply && p.actor === "human_admin",
  );

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

  const stats = conversation?.statistics ?? {};
  const ttrS = typeof stats.time_to_last_close === "number" ? stats.time_to_last_close : null;
  const reopenCount = typeof stats.count_reopens === "number" ? stats.count_reopens : 0;

  const handlingTimeS = sumCustomerWaitGaps(timeline, (a, b) => Math.max(0, b - a));
  const handlingTimeBusinessHoursS = sumCustomerWaitGaps(timeline, (a, b) => businessHoursBetween(a, b));

  const samParticipated = timeline.some((p) => p.isPublicReply && p.actor === "sam_ai");
  const noHumanReply = !firstHumanReply;

  return {
    createdAtS: createdAt,
    firstResponseAnyAgentS,
    timeToEscalationS,
    escalationTs: escalation?.ts ?? null,
    escalationBasis: escalation?.basis ?? null,
    firstHumanReplyFromEscalationS,
    firstHumanReplyFromOpenS,
    ttrS,
    reopenCount,
    handlingTimeS,
    handlingTimeBusinessHoursS,
    partsCount: timeline.length,
    flags: {
      isTicket: !!conversation?.ticket,
      samParticipated,
      noHumanReply,
      hasParts: timeline.length > 0,
    },
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
