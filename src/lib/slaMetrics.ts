// SLA metric helpers for the /sla-test prototype.
// All inputs are Intercom raw_payload shapes; all outputs are seconds (or null).

export type Part = {
  ts: number; // unix seconds
  authorType: "user" | "admin" | "bot" | "other";
  partType: string;
};

const VISIBLE_PART_TYPES = new Set([
  "comment",
  "close",
  "open",
  "assign_and_reopen",
  "away_mode_assignment",
  "default_assignment",
  "conversation_attribute_updated_by_workflow",
]);

// Extract ordered parts from an Intercom conversation raw payload.
// The initial source message is prepended as a user event.
export function extractParts(raw: any): Part[] {
  const parts: Part[] = [];
  const src = raw?.source;
  if (src && typeof raw?.created_at === "number") {
    parts.push({
      ts: raw.created_at,
      authorType: normalizeAuthor(src.author?.type),
      partType: "source",
    });
  }
  const arr = raw?.conversation_parts?.conversation_parts;
  if (Array.isArray(arr)) {
    for (const p of arr) {
      const pt = String(p?.part_type || "");
      // Drop internal notes / pure assignment events — keep visible conversation events.
      if (pt === "note" || pt === "assignment" || pt === "note_and_reopen") continue;
      if (!VISIBLE_PART_TYPES.has(pt) && !pt.includes("comment")) continue;
      if (typeof p?.created_at !== "number") continue;
      parts.push({
        ts: p.created_at,
        authorType: normalizeAuthor(p?.author?.type),
        partType: pt,
      });
    }
  }
  parts.sort((a, b) => a.ts - b.ts);
  return parts;
}

function normalizeAuthor(t: any): Part["authorType"] {
  const s = String(t || "").toLowerCase();
  if (s === "user" || s === "lead" || s === "contact") return "user";
  if (s === "admin") return "admin";
  if (s === "bot") return "bot";
  return "other";
}

// Sum of gaps from each user message to the next admin/bot reply.
// Trailing user messages (no admin reply after) are excluded.
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

// Business hours: Mon–Fri, 09:00–23:59 UTC (treated as 09:00 → 24:00 = 15h/day).
// Returns the number of business-hour seconds within [startSec, endSec].
const BH_START_HOUR = 9;
const BH_END_HOUR = 24; // exclusive upper bound = 23:59:59.999
const BH_SECS_PER_DAY = (BH_END_HOUR - BH_START_HOUR) * 3600;

export function businessHoursBetween(startSec: number, endSec: number): number {
  if (endSec <= startSec) return 0;
  let total = 0;
  // Iterate day-by-day in UTC. Bounded by max ~30 days per gap in practice; safe even for longer.
  const startMs = startSec * 1000;
  const endMs = endSec * 1000;
  let cursor = new Date(startMs);
  cursor.setUTCHours(0, 0, 0, 0);
  while (cursor.getTime() < endMs) {
    const dayStart = cursor.getTime();
    const nextDay = dayStart + 86_400_000;
    const dow = new Date(dayStart).getUTCDay(); // 0=Sun, 6=Sat
    if (dow !== 0 && dow !== 6) {
      const windowStart = dayStart + BH_START_HOUR * 3600 * 1000;
      const windowEnd = dayStart + BH_END_HOUR * 3600 * 1000;
      const overlapStart = Math.max(startMs, windowStart);
      const overlapEnd = Math.min(endMs, windowEnd);
      if (overlapEnd > overlapStart) total += (overlapEnd - overlapStart) / 1000;
    }
    cursor = new Date(nextDay);
  }
  return Math.min(total, (endSec - startSec));
}

// Same walk as sumUserToAdminGaps, but each gap is clipped to business hours.
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

export function aggregate(values: number[]): { avg: number | null; median: number | null; p90: number | null; n: number } {
  const clean = values.filter((v) => typeof v === "number" && isFinite(v) && v > 0);
  if (!clean.length) return { avg: null, median: null, p90: null, n: 0 };
  const sorted = [...clean].sort((a, b) => a - b);
  const avg = clean.reduce((a, b) => a + b, 0) / clean.length;
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  const rank = 0.9 * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const p90 = lo === hi ? sorted[lo] : sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
  return { avg, median, p90, n: clean.length };
}

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
