// SLA core — the SINGLE source of truth for actor classification, timeline
// extraction, business hours, and the stop-the-clock ACTIVE RESOLUTION clock.
//
// This file lives under supabase/functions/_shared so Deno edge functions can
// import it. `src/lib/slaMetrics.ts` imports and re-exports from here, so the
// frontend engine and the finalize/backfill writers run the SAME rule — there
// is no second copy.
//
// Pure TypeScript: no network, no DB, no Deno/Node globals.

/** Bump when the active-clock RULE changes, so stale rows can be re-backfilled. */
export const ACTIVE_CLOCK_ENGINE_VERSION = 2;

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
// these as human_admin, not customer.
export const TEAMMATE_EMAIL_DOMAIN = "lovable.dev";

// Shared relay inboxes that forward CUSTOMER content in under an @lovable.dev
// address (B6). Customer-side, never our reply.
export const SHARED_MAILBOX_EMAILS: ReadonlySet<string> = new Set([
  "enterprise-support@lovable.dev",
]);

/** Intercom team id for the Enterprise Inbox — the SLA clock-start anchor. */
export const ENTERPRISE_INBOX_TEAM_ID = "8484447";

const ANCHOR_TEAM_IDS = new Set<string>([ENTERPRISE_INBOX_TEAM_ID]);

/** Register additional inbox team ids that start the SLA clock (idempotent). */
export function registerAnchorTeamIds(ids: Array<string | null | undefined>): void {
  for (const id of ids) {
    const t = String(id ?? "").trim();
    if (t) ANCHOR_TEAM_IDS.add(t);
  }
}

export function isAnchorTeamId(id: unknown): boolean {
  return ANCHOR_TEAM_IDS.has(String(id ?? ""));
}

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
  // MUST precede the @lovable.dev → human_admin rule.
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
  authorEmail: string | null;
  partType: string;
  body: string; // stripped, may be ""
  isPublicReply: boolean;
  isNote: boolean;
  assignedToType: "admin" | "team" | null;
  assignedToId: string | null;
  eventDetails: any | null;
  relayFrom: string | null;
};

// `[From: tine via Slack]` → "tine". Only matches at the START of the body.
const RELAY_PREFIX_RE = /^\s*\[from:\s*([^\]]+?)\s+via\s+slack\]/i;

export function parseRelayFrom(body: string): string | null {
  const m = RELAY_PREFIX_RE.exec(body || "");
  const name = m?.[1]?.trim().toLowerCase();
  return name ? name : null;
}

export function stripHtml(s: any): string {
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

function isPublicReplyPart(partType: string, body: string): boolean {
  if (partType === "comment") return true;
  if (partType === "assignment" && body.length > 0) return true;
  return false;
}

function isNotePart(partType: string): boolean {
  return partType === "note" || partType === "note_and_reopen";
}

function readAssignmentTarget(p: any): { type: "admin" | "team" | null; id: string | null } {
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
      isPublicReply: false,
      isNote: false,
      assignedToType: null,
      assignedToId: null,
      eventDetails: null,
      relayFrom: parseRelayFrom(body),
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
        relayFrom: parseRelayFrom(body),
      });
    }
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

// ============================================================================
// Business hours — Europe/Berlin, DST-aware
// ============================================================================

export const BUSINESS_HOURS_TIMEZONE = "Europe/Berlin";
export const BUSINESS_HOURS_START_HOUR = 9;
export const BUSINESS_HOURS_END_HOUR = 24; // exclusive upper = 23:59:59.999

export type BusinessHoursConfig = {
  tz: string;
  workDays: number[];
  dayStartHour: number;
  dayEndHour: number;
  holidays: string[];
};

export const DEFAULT_BUSINESS_HOURS: BusinessHoursConfig = {
  tz: BUSINESS_HOURS_TIMEZONE,
  workDays: [1, 2, 3, 4, 5],
  dayStartHour: BUSINESS_HOURS_START_HOUR,
  dayEndHour: BUSINESS_HOURS_END_HOUR,
  holidays: [],
};

const tzFmtCache = new Map<string, Intl.DateTimeFormat>();
function tzFmt(tz: string): Intl.DateTimeFormat {
  let f = tzFmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    tzFmtCache.set(tz, f);
  }
  return f;
}

function localYMDH(
  ms: number,
  tz: string,
): { y: number; m: number; d: number; hour: number; minute: number; second: number; dow: number } {
  const parts = tzFmt(tz).formatToParts(new Date(ms));
  const map: Record<string, string> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = p.value;
  const y = Number(map.year);
  const m = Number(map.month);
  const d = Number(map.day);
  const hour = Number(map.hour) % 24;
  const minute = Number(map.minute);
  const second = Number(map.second);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return { y, m, d, hour, minute, second, dow };
}

function localHourToUtcMs(refMs: number, targetHour: number, tz: string): number {
  const { y, m, d } = localYMDH(refMs, tz);
  let guess = Date.UTC(y, m - 1, d, targetHour, 0, 0, 0);
  for (let i = 0; i < 3; i++) {
    const parts = localYMDH(guess, tz);
    const wantMinutes = targetHour * 60;
    const gotMinutes = parts.hour * 60 + parts.minute;
    const dateDeltaDays =
      (Date.UTC(parts.y, parts.m - 1, parts.d) - Date.UTC(y, m - 1, d)) / 86_400_000;
    const deltaMin = (dateDeltaDays * 24 * 60) + (gotMinutes - wantMinutes);
    if (deltaMin === 0) break;
    guess -= deltaMin * 60_000;
  }
  return guess;
}

function ymdKey(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function businessHoursBetween(
  startSec: number,
  endSec: number,
  config: BusinessHoursConfig = DEFAULT_BUSINESS_HOURS,
): number {
  if (endSec <= startSec) return 0;
  const { tz, workDays, dayStartHour, dayEndHour, holidays } = config;
  const workDaySet = new Set(workDays);
  const holidaySet = holidays && holidays.length ? new Set(holidays) : null;
  const startMs = startSec * 1000;
  const endMs = endSec * 1000;
  let total = 0;

  let cursorMs = localHourToUtcMs(startMs, 0, tz);
  const MAX_ITER = 400;
  for (let i = 0; i < MAX_ITER && cursorMs < endMs; i++) {
    const { y, m, d, dow } = localYMDH(cursorMs, tz);
    const windowStart = localHourToUtcMs(cursorMs, dayStartHour, tz);
    const windowEnd = localHourToUtcMs(cursorMs, dayEndHour, tz);
    const isHoliday = holidaySet ? holidaySet.has(ymdKey(y, m, d)) : false;
    if (workDaySet.has(dow) && !isHoliday) {
      const overlapStart = Math.max(startMs, windowStart);
      const overlapEnd = Math.min(endMs, windowEnd);
      if (overlapEnd > overlapStart) total += (overlapEnd - overlapStart) / 1000;
    }
    cursorMs = localHourToUtcMs(cursorMs + 25 * 3600 * 1000, 0, tz);
  }
  return Math.min(total, endSec - startSec);
}

/** Business-day length implied by a config (default 54000s). */
export function businessDaySeconds(
  config: BusinessHoursConfig = DEFAULT_BUSINESS_HOURS,
): number {
  return (config.dayEndHour - config.dayStartHour) * 3600;
}

// ============================================================================
// Support roster re-attribution (relay)
// ============================================================================

export type SupportRoster = {
  supportEmails?: Set<string>;
  supportAdminIds?: Set<string>;
  supportSlackNames?: Set<string>;
};

function relayEmailOf(v: string | null): string | null {
  const m = /[\w.+-]+@[\w.-]+\.\w{2,}/.exec(v || "");
  return m ? m[0].toLowerCase() : null;
}

/** True when a relayed part was actually written by a SUPPORT teammate. */
export function isRelaySupportPart(p: TimelinePart, roster?: SupportRoster): boolean {
  if (!p.relayFrom) return false;
  const em = relayEmailOf(p.relayFrom);
  if (em && roster?.supportEmails?.has(em)) return true;
  return !!(roster?.supportSlackNames && roster.supportSlackNames.has(p.relayFrom));
}

/** Re-attribute Slack-relayed teammate replies to `human_admin`. */
export function reattributeRelay(timeline: TimelinePart[], roster?: SupportRoster): TimelinePart[] {
  return timeline.map((p) =>
    isRelaySupportPart(p, roster) && p.actor !== "human_admin"
      ? { ...p, actor: "human_admin" as Actor }
      : p,
  );
}

// ============================================================================
// Active resolution clock (stop-the-clock)
// ============================================================================

/**
 * SLA clock-start = first anchor-inbox team assignment, else created_at.
 */
export function resolveClockStart(
  timeline: TimelinePart[],
  createdAtS: number | null,
): { slaClockStartS: number | null; inboxAssignedAtS: number | null } {
  const assign = timeline.find(
    (p) => p.assignedToType === "team" && isAnchorTeamId(p.assignedToId),
  );
  const inboxAssignedAtS = assign?.ts ?? null;
  return {
    slaClockStartS: inboxAssignedAtS != null ? inboxAssignedAtS : createdAtS,
    inboxAssignedAtS,
  };
}

/** Last close timestamp from Intercom statistics (last_close_at, else first_close_at). */
export function resolveCloseAt(stats: any): number | null {
  if (typeof stats?.last_close_at === "number") return stats.last_close_at;
  if (typeof stats?.first_close_at === "number") return stats.first_close_at;
  return null;
}

/**
 * Stop-the-clock resolution — active in-our-court time from the SLA clock-start
 * to the last close.
 *
 * A close STOPS the clock: the ball is no longer ours once the ticket is closed.
 * A later customer message (or relayed customer content) starts a fresh
 * in-our-court segment. Without this, a close that follows the customer's last
 * word left the ball "with us"; on a later reopen, last_close jumped forward and
 * the whole dormant gap was wrongly counted as active resolution time.
 */
export function computeResolutionActive(
  timeline: TimelinePart[],
  slaClockStartS: number | null,
  closeAtS: number | null,
  clip: (a: number, b: number) => number,
): number | null {
  if (slaClockStartS == null || closeAtS == null) return null;
  if (closeAtS < slaClockStartS) return 0;
  let total = 0;
  let ballWithUs = true;
  let segStart = slaClockStartS;
  for (const p of timeline) {
    if (p.ts < slaClockStartS || p.ts > closeAtS) continue;
    if (p.partType === "close") {
      if (ballWithUs) {
        total += clip(segStart, p.ts);
        ballWithUs = false;
      }
      continue;
    }
    // `shared_inbox` relays CUSTOMER content — it RETURNS the ball to us (B6).
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
  if (ballWithUs) total += clip(segStart, closeAtS);
  return total;
}

/**
 * Dormant (closed) seconds inside the resolution window: time between a close
 * and the next activity that follows it, before the final close. This is the
 * part of raw `time_to_resolve_s` that must NOT be reported as resolution time.
 */
export function computeClosedDormant(
  timeline: TimelinePart[],
  slaClockStartS: number | null,
  closeAtS: number | null,
): number | null {
  if (slaClockStartS == null || closeAtS == null) return null;
  let total = 0;
  let closedSince: number | null = null;
  for (const p of timeline) {
    if (p.ts < slaClockStartS || p.ts > closeAtS) continue;
    if (p.partType === "close") {
      closedSince = p.ts;
      continue;
    }
    if (closedSince != null) {
      total += Math.max(0, p.ts - closedSince);
      closedSince = null;
    }
  }
  return total;
}

/** A half-open [startS, endS) stretch where the ball was NOT with us. */
export type WaitSegment = { startS: number; endS: number };

/**
 * The waiting-on-customer stretches inside the resolution window — the exact
 * mirror of `computeResolutionActive`: the ball is NOT with us AND the ticket
 * is NOT closed. Same actor rules, same window, so
 * active + closed + wait == window by construction.
 *
 * Returned as segments (rather than a sum) so the engineering-wait bucket can
 * be carved out of exactly this time and never out of active or closed time.
 */
export function customerWaitSegments(
  timeline: TimelinePart[],
  slaClockStartS: number | null,
  closeAtS: number | null,
): WaitSegment[] | null {
  if (slaClockStartS == null || closeAtS == null) return null;
  if (closeAtS < slaClockStartS) return [];
  const segments: WaitSegment[] = [];
  // State at the clock start: ball with us, ticket open.
  let ballWithUs = true;
  let closed = false;
  let segStart: number | null = null; // start of the current waiting-on-customer stretch
  const endWait = (at: number) => {
    if (segStart != null) {
      if (at > segStart) segments.push({ startS: segStart, endS: at });
      segStart = null;
    }
  };
  for (const p of timeline) {
    if (p.ts < slaClockStartS || p.ts > closeAtS) continue;
    if (p.partType === "close") {
      // A close stops both open clocks; the gap that follows is dormant time
      // and belongs to resolution_closed_s.
      endWait(p.ts);
      closed = true;
      ballWithUs = false;
      continue;
    }
    // Any non-close part ends dormancy — same rule as computeClosedDormant.
    closed = false;
    if (p.actor === "customer" || p.actor === "shared_inbox") {
      // Customer content returns the ball to us (B6).
      endWait(p.ts);
      ballWithUs = true;
    } else if (p.isPublicReply && (p.actor === "human_admin" || p.actor === "sam_ai")) {
      if (ballWithUs) ballWithUs = false;
      if (segStart == null) segStart = p.ts;
    } else if (!ballWithUs && segStart == null) {
      // Post-dormancy activity that neither side "owns" (notes, assignments):
      // the ball is still not with us, so the time is customer wait.
      segStart = p.ts;
    }
  }
  if (!ballWithUs && !closed) endWait(closeAtS);
  return segments;
}

/** Total waiting-on-customer seconds (engineering wait NOT yet carved out). */
export function computeCustomerWait(
  timeline: TimelinePart[],
  slaClockStartS: number | null,
  closeAtS: number | null,
  clip: (a: number, b: number) => number,
): number | null {
  const segs = customerWaitSegments(timeline, slaClockStartS, closeAtS);
  if (segs == null) return null;
  let total = 0;
  for (const s of segs) total += clip(s.startS, s.endS);
  return total;
}

// ============================================================================
// Engineering wait — "looks like waiting on the customer, is actually on us"
// ============================================================================

/** Intercom custom attributes that carry the Linear reference. */
export const LINEAR_ATTRIBUTE_NAMES: ReadonlySet<string> = new Set([
  "Escalated Issue",
  "Linear Issue",
]);

export type EngWaitSource = "attribute_event" | "dev_escalation_row" | "linear_created";

/** Escalation facts that live outside the Intercom payload (Linear / Hub board). */
export type EngEscalation = {
  /** dev_escalations.created_at (seconds) — when the Hub first saw the escalation. */
  escalationRowAtS?: number | null;
  linearCreatedAtS?: number | null;
  linearCompletedAtS?: number | null;
  linearCanceledAtS?: number | null;
};

/**
 * Earliest moment the ticket carried a Linear reference, read from the
 * timestamped `conversation_attribute_updated_by_admin` parts in the payload.
 */
export function findLinearAttributeTs(timeline: TimelinePart[]): number | null {
  let best: number | null = null;
  for (const p of timeline) {
    if (p.partType !== "conversation_attribute_updated_by_admin") continue;
    const name = String(p.eventDetails?.attribute?.name ?? "");
    if (!LINEAR_ATTRIBUTE_NAMES.has(name)) continue;
    const value = String(p.eventDetails?.value?.name ?? "").trim();
    if (!value) continue; // clearing the attribute does not open a window
    if (best == null || p.ts < best) best = p.ts;
  }
  return best;
}

export type EngWaitWindow = {
  startS: number | null;
  endS: number | null;
  source: EngWaitSource | null;
};

/**
 * Resolve the engineering-wait window: from the first evidence the ticket was
 * handed to engineering, until the Linear issue was completed/canceled (else
 * the ticket close). Clamped into the resolution window.
 */
export function resolveEngWaitWindow(
  timeline: TimelinePart[],
  slaClockStartS: number | null,
  closeAtS: number | null,
  esc?: EngEscalation | null,
): EngWaitWindow {
  const none: EngWaitWindow = { startS: null, endS: null, source: null };
  if (slaClockStartS == null || closeAtS == null) return none;

  const attrTs = findLinearAttributeTs(timeline);
  let startS: number | null = null;
  let source: EngWaitSource | null = null;
  if (attrTs != null) {
    startS = attrTs;
    source = "attribute_event";
  } else if (esc?.escalationRowAtS != null) {
    startS = esc.escalationRowAtS;
    source = "dev_escalation_row";
  } else if (esc?.linearCreatedAtS != null) {
    startS = esc.linearCreatedAtS;
    source = "linear_created";
  }
  if (startS == null) return none;

  const done = [esc?.linearCompletedAtS, esc?.linearCanceledAtS].filter(
    (v): v is number => typeof v === "number",
  );
  const linearDoneS = done.length ? Math.min(...done) : null;
  let endS = linearDoneS != null ? Math.min(linearDoneS, closeAtS) : closeAtS;

  startS = Math.max(startS, slaClockStartS);
  if (startS > closeAtS) return none; // reference attached after the ticket closed
  if (endS < startS) endS = startS;
  return { startS, endS, source };
}

/**
 * Engineering-wait seconds = the intersection of the engineering-wait window
 * with the waiting-on-customer segments. Active and closed time are never
 * reclassified.
 */
export function computeEngineeringWait(
  segments: WaitSegment[] | null,
  window: EngWaitWindow,
  clip: (a: number, b: number) => number,
): number | null {
  if (segments == null) return null;
  if (window.startS == null || window.endS == null) return 0;
  let total = 0;
  for (const s of segments) {
    const a = Math.max(s.startS, window.startS);
    const b = Math.min(s.endS, window.endS);
    if (b > a) total += clip(a, b);
  }
  return total;
}

export type ActiveClockResult = {
  slaClockStartS: number | null;
  closeAtS: number | null;
  resolutionActiveS: number | null;
  resolutionActiveBhS: number | null;
  resolutionClosedS: number | null;
  /** Waiting on the customer, with engineering wait already carved out. */
  resolutionCustomerWaitS: number | null;
  resolutionCustomerWaitBhS: number | null;
  resolutionEngWaitS: number | null;
  resolutionEngWaitBhS: number | null;
  engWaitStartS: number | null;
  engWaitEndS: number | null;
  engWaitSource: EngWaitSource | null;
  /** close_at − sla_clock_start: active + closed + wait + eng_wait sum to it. */
  resolutionWindowS: number | null;
  rawResolveS: number | null;
  partsCount: number;
  engineVersion: number;
};

/**
 * End-to-end active clock from a raw Intercom conversation payload (live API
 * response or stored `raw_payload`). Used by the finalize writer and the
 * backfill so the persisted column matches the frontend engine exactly.
 */
export function computeActiveClock(
  conversation: any,
  opts?: {
    roster?: SupportRoster;
    businessHours?: BusinessHoursConfig;
    /** Linear / Hub escalation facts for this conversation, when known. */
    escalation?: EngEscalation | null;
  },
): ActiveClockResult {
  const businessHours = opts?.businessHours ?? DEFAULT_BUSINESS_HOURS;
  const timeline = reattributeRelay(extractTimeline(conversation), opts?.roster);
  const createdAtS =
    typeof conversation?.created_at === "number" ? conversation.created_at : null;
  const { slaClockStartS } = resolveClockStart(timeline, createdAtS);
  const stats = conversation?.statistics ?? {};
  const closeAtS = resolveCloseAt(stats);
  const rawResolveS =
    typeof stats?.time_to_last_close === "number" ? stats.time_to_last_close : null;

  const wall = (a: number, b: number) => Math.max(0, b - a);
  const bh = (a: number, b: number) => businessHoursBetween(a, b, businessHours);

  const waitSegs = customerWaitSegments(timeline, slaClockStartS, closeAtS);
  const engWindow = resolveEngWaitWindow(timeline, slaClockStartS, closeAtS, opts?.escalation);
  const waitTotalS = waitSegs == null ? null : waitSegs.reduce((n, s) => n + wall(s.startS, s.endS), 0);
  const waitTotalBhS = waitSegs == null ? null : waitSegs.reduce((n, s) => n + bh(s.startS, s.endS), 0);
  const engS = computeEngineeringWait(waitSegs, engWindow, wall);
  const engBhS = computeEngineeringWait(waitSegs, engWindow, bh);

  return {
    slaClockStartS,
    closeAtS,
    resolutionActiveS: computeResolutionActive(timeline, slaClockStartS, closeAtS, wall),
    resolutionActiveBhS: computeResolutionActive(timeline, slaClockStartS, closeAtS, bh),
    resolutionClosedS: computeClosedDormant(timeline, slaClockStartS, closeAtS),
    resolutionCustomerWaitS:
      waitTotalS == null ? null : Math.max(0, waitTotalS - (engS ?? 0)),
    resolutionCustomerWaitBhS:
      waitTotalBhS == null ? null : Math.max(0, waitTotalBhS - (engBhS ?? 0)),
    resolutionEngWaitS: engS,
    resolutionEngWaitBhS: engBhS,
    engWaitStartS: (engS ?? 0) > 0 ? engWindow.startS : null,
    engWaitEndS: (engS ?? 0) > 0 ? engWindow.endS : null,
    engWaitSource: (engS ?? 0) > 0 ? engWindow.source : null,
    resolutionWindowS:
      slaClockStartS != null && closeAtS != null
        ? Math.max(0, closeAtS - slaClockStartS)
        : null,
    rawResolveS,
    partsCount: timeline.length,
    engineVersion: ACTIVE_CLOCK_ENGINE_VERSION,
  };
}
