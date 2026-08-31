/**
 * Resolution anatomy — decompose a ticket's wall clock by "who owed the next move".
 *
 * The Hub can already say a ticket took 14 days. It cannot say WHY. This module
 * walks the same Intercom timeline the SLA engine reads and attributes every gap
 * between consecutive messages to the side that owed the reply:
 *
 *   our clock    — a customer message sat waiting for a human admin reply
 *   their clock  — our reply sat waiting for the customer to come back
 *   silent drift — nothing was said by anyone, up to the close
 *
 * Read-only and derived: nothing here is persisted, and nothing here changes an
 * existing SLA / Analytics number.
 *
 * Actor mapping (reuses classifyActor):
 *   customer-side : "customer", "shared_inbox"   (B6 — the relay inbox is the customer talking)
 *   our side      : "human_admin"
 *   neutral       : "sam_ai", "operator_bot", "system"
 *
 * Sam AI and bots are deliberately NEUTRAL: an automated acknowledgement does
 * not discharge our obligation to reply, and it does not put the ball back in
 * the customer's court. A neutral part therefore does not open or close a gap;
 * the clock keeps running for whoever already owed a move.
 */

import {
  classifyActor,
  extractTimeline,
  businessHoursBetween,
  DEFAULT_BUSINESS_HOURS,
  type Actor,
  type BusinessHoursConfig,
  type TimelinePart,
} from "@/lib/slaMetrics";

export type OwedBy = "us" | "customer" | "nobody";

export type GapSegment = {
  /** Index in the timeline of the part that OPENED the gap. -1 for the trailing drift. */
  afterIndex: number;
  startTs: number;
  endTs: number;
  seconds: number;
  businessSeconds: number;
  owedBy: OwedBy;
};

export type AnatomyResult = {
  /** null when the conversation carries no usable timeline — never 0. */
  totalS: number | null;
  ourClockS: number | null;
  theirClockS: number | null;
  driftS: number | null;
  ourClockBizS: number | null;
  theirClockBizS: number | null;

  longestGap: GapSegment | null;
  segments: GapSegment[];
  timeline: TimelinePart[];

  replyCount: number;
  adminReplyCount: number;
  customerReplyCount: number;

  /** true when the last substantive message before close came from our side. */
  closedWithoutCustomerConfirm: boolean | null;
  /** Wall-clock seconds from conversation open to the FIRST close event. */
  timeToFirstCloseS: number | null;

  /** Set when the split could not be computed. */
  unavailableReason: string | null;
};

const EMPTY: AnatomyResult = {
  totalS: null,
  ourClockS: null,
  theirClockS: null,
  driftS: null,
  ourClockBizS: null,
  theirClockBizS: null,
  longestGap: null,
  segments: [],
  timeline: [],
  replyCount: 0,
  adminReplyCount: 0,
  customerReplyCount: 0,
  closedWithoutCustomerConfirm: null,
  timeToFirstCloseS: null,
  unavailableReason: "no_timeline",
};

function side(actor: Actor): OwedBy | null {
  if (actor === "customer" || actor === "shared_inbox") return "us";
  if (actor === "human_admin") return "customer";
  return null; // neutral — does not change who owes the next move
}

/** Parts that count as "somebody spoke". Notes and state events do not. */
function isSubstantive(p: TimelinePart): boolean {
  if (p.isNote) return false;
  if (p.partType === "source") return true;
  if (p.isPublicReply) return true;
  return p.partType === "comment" && p.body.trim().length > 0;
}

function firstCloseTs(timeline: TimelinePart[]): number | null {
  for (const p of timeline) {
    if (p.partType === "close") return p.ts;
  }
  return null;
}

export type AnatomyOptions = {
  /** Conversation close timestamp (unix seconds) — the end of the wall clock. */
  closedAtSec?: number | null;
  businessHours?: BusinessHoursConfig;
};

export function computeAnatomy(raw: any, opts: AnatomyOptions = {}): AnatomyResult {
  const bh = opts.businessHours ?? DEFAULT_BUSINESS_HOURS;
  const full = extractTimeline(raw);
  if (!full.length) return { ...EMPTY };

  const parts = full.filter(isSubstantive);
  if (!parts.length) return { ...EMPTY, timeline: full, unavailableReason: "no_substantive_parts" };

  const startTs = parts[0].ts;
  const lastTs = parts[parts.length - 1].ts;
  const closeTs = typeof opts.closedAtSec === "number" && opts.closedAtSec > lastTs
    ? opts.closedAtSec
    : lastTs;
  const totalS = Math.max(0, closeTs - startTs);

  const segments: GapSegment[] = [];
  // Who currently owes the next move; seeded by the opening message.
  let owed: OwedBy = side(parts[0].actor) ?? "nobody";
  let segStart = parts[0].ts;
  let segStartIndex = 0;

  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    const s = side(p.actor);
    if (s === null) continue; // neutral part — clock keeps running for `owed`
    if (p.ts > segStart) {
      segments.push(makeSegment(segStartIndex, segStart, p.ts, owed, bh));
    }
    owed = s;
    segStart = p.ts;
    segStartIndex = i;
  }

  // Trailing stretch from the last message to the close. Whoever owed a move
  // still owed it; if nobody did, this is silent drift.
  if (closeTs > segStart) {
    segments.push(makeSegment(segStartIndex, segStart, closeTs, owed, bh));
  }

  let ourClockS = 0;
  let theirClockS = 0;
  let driftS = 0;
  let ourClockBizS = 0;
  let theirClockBizS = 0;
  for (const s of segments) {
    if (s.owedBy === "us") { ourClockS += s.seconds; ourClockBizS += s.businessSeconds; }
    else if (s.owedBy === "customer") { theirClockS += s.seconds; theirClockBizS += s.businessSeconds; }
    else driftS += s.seconds;
  }

  let longestGap: GapSegment | null = null;
  for (const s of segments) {
    if (!longestGap || s.seconds > longestGap.seconds) longestGap = s;
  }

  let adminReplyCount = 0;
  let customerReplyCount = 0;
  for (let i = 0; i < parts.length; i++) {
    const s = side(parts[i].actor);
    if (s === "customer") adminReplyCount++;      // owed BY customer next ⇒ we spoke
    else if (s === "us") customerReplyCount++;    // owed BY us next ⇒ customer spoke
  }

  // Who spoke last, ignoring neutral parts.
  let lastSide: OwedBy | null = null;
  for (let i = parts.length - 1; i >= 0; i--) {
    const s = side(parts[i].actor);
    if (s !== null) { lastSide = s; break; }
  }

  const closeTsEvent = firstCloseTs(full);

  return {
    totalS,
    ourClockS,
    theirClockS,
    driftS,
    ourClockBizS,
    theirClockBizS,
    longestGap,
    segments,
    timeline: full,
    replyCount: adminReplyCount + customerReplyCount,
    adminReplyCount,
    customerReplyCount,
    // lastSide === "customer" means the CUSTOMER owes the next move, i.e. we
    // spoke last and closed without them coming back.
    closedWithoutCustomerConfirm: lastSide === null ? null : lastSide === "customer",
    timeToFirstCloseS: closeTsEvent != null ? Math.max(0, closeTsEvent - startTs) : null,
    unavailableReason: null,
  };
}

function makeSegment(
  afterIndex: number,
  startTs: number,
  endTs: number,
  owedBy: OwedBy,
  bh: BusinessHoursConfig,
): GapSegment {
  return {
    afterIndex,
    startTs,
    endTs,
    seconds: Math.max(0, endTs - startTs),
    businessSeconds: businessHoursBetween(startTs, endTs, bh),
    owedBy,
  };
}

/** Sums the three buckets — must equal totalS. Used by the reconciliation check. */
export function anatomyReconciles(a: AnatomyResult, toleranceS = 1): boolean {
  if (a.totalS == null) return true;
  const sum = (a.ourClockS ?? 0) + (a.theirClockS ?? 0) + (a.driftS ?? 0);
  return Math.abs(sum - a.totalS) <= toleranceS;
}
