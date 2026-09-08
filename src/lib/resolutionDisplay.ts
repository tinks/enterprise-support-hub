/**
 * Single owner of resolution-metric labelling and null/zero handling.
 *
 * The Hub reports TWO different numbers and they must never be confused:
 *
 *  - Resolution (active) — `resolution_active_s`. Excludes time the ticket was
 *    closed and time we were waiting on the customer. THE headline metric.
 *  - Elapsed (raw)       — `time_to_resolve_s`. Calendar wall clock, the same
 *    figure Intercom reports. Reconciliation only: tooltips, drill-downs and
 *    export columns. Never a headline, never a chart series beside active,
 *    never in a Slack summary.
 *
 * Every surface imports its labels from here so the wording cannot drift.
 */

export const ACTIVE_LABEL = "Resolution (active)";
export const RAW_LABEL = "Elapsed (raw)";

export const ACTIVE_TOOLTIP =
  "Time the ticket was actually open and waiting on us. Excludes closed periods and time waiting on the customer.";
export const RAW_TOOLTIP =
  "Calendar time from first inbound to last close, including closed and waiting-on-customer periods. Matches Intercom's native figure. Shown for reconciliation only.";

export const ACTIVE_CLOCK_ENGINE_VERSION = 1;

/** Fields a row must carry for the helpers below. */
export type ResolutionRow = {
  lifecycle_status?: string | null;
  resolution_active_s?: number | null;
  time_to_resolve_s?: number | null;
  active_clock_engine_version?: number | null;
  /** Engine v3 four-way split. Present from `active_clock_engine_version >= 3`. */
  resolution_customer_wait_s?: number | null;
  resolution_eng_wait_s?: number | null;
  resolution_closed_s?: number | null;
  resolution_window_s?: number | null;
};


/**
 * A finalized row whose active clock could not be computed (no usable timeline
 * in the payload, or never stamped by the engine). Counted and surfaced, never
 * silently treated as zero.
 */
export function isNotComputable(r: ResolutionRow): boolean {
  if (r.lifecycle_status !== "finalized") return false;
  if (r.active_clock_engine_version == null) return true;
  return typeof r.resolution_active_s !== "number";
}

/**
 * Active seconds for a finalized row, or null when not computable.
 * A genuine 0 is returned as 0 — those tickets are real (we replied instantly
 * and the customer never came back) and belong in the median.
 */
export function activeSeconds(r: ResolutionRow): number | null {
  if (isNotComputable(r)) return null;
  return typeof r.resolution_active_s === "number" ? r.resolution_active_s : null;
}

export function rawSeconds(r: ResolutionRow): number | null {
  return typeof r.time_to_resolve_s === "number" ? r.time_to_resolve_s : null;
}

export type ActiveSample = {
  /** Active seconds for every computable finalized row, including genuine zeros. */
  values: number[];
  /** Finalized rows with no computable active clock. */
  notComputable: number;
  /** Computable rows whose active time is exactly zero. */
  zeroActive: number;
};

/** Collect the active-clock sample from a set of finalized rows. */
export function collectActive(rows: ResolutionRow[]): ActiveSample {
  const values: number[] = [];
  let notComputable = 0;
  let zeroActive = 0;
  for (const r of rows) {
    const v = activeSeconds(r);
    if (v == null) {
      if (r.lifecycle_status === "finalized") notComputable++;
      continue;
    }
    values.push(v);
    if (v === 0) zeroActive++;
  }
  return { values, notComputable, zeroActive };
}

/** Raw sample, kept to the same population shape for reconciliation. */
export function collectRaw(rows: ResolutionRow[]): number[] {
  const out: number[] = [];
  for (const r of rows) {
    const v = rawSeconds(r);
    if (typeof v === "number" && v > 0) out.push(v);
  }
  return out;
}

/** "2 not computable" / "" — the sub-line shown beside an active KPI. */
export function notComputableNote(n: number): string {
  return n > 0 ? `${n} not computable` : "";
}

export const ACTIVE_FOOTNOTE =
  "Resolution (active) reads the persisted resolution_active_s column, computed at finalize and recomputed on every reopen. It excludes closed and waiting-on-customer time. Elapsed (raw) is the Intercom wall-clock figure, kept for reconciliation only.";

/* ------------------------------------------------------------------------- *
 * Engine v3 — the four-way split
 *
 * `resolution_window_s` is the measured window, and the engine guarantees
 *   active + customer_wait + eng_wait + closed = window
 * on every row it stamped. The four buckets answer "where did the elapsed time
 * go", which is a DIFFERENT question from "how long did we take" — only
 * `resolution_active_s` is ever a headline. The split is a sub-line, a tooltip
 * or a drill-down, never a KPI of its own and never a chart series beside the
 * headline.
 * ------------------------------------------------------------------------- */

export const SPLIT_KEYS = ["active", "customerWait", "engWait", "closed"] as const;
export type SplitKey = (typeof SPLIT_KEYS)[number];

export const SPLIT_LABEL: Record<SplitKey, string> = {
  active: "Active",
  customerWait: "Customer wait",
  engWait: "Engineering wait",
  closed: "Closed",
};

export const SPLIT_SHORT: Record<SplitKey, string> = {
  active: "active",
  customerWait: "cust",
  engWait: "eng",
  closed: "closed",
};

export const SPLIT_TOOLTIP: Record<SplitKey, string> = {
  active:
    "Ticket open and the ball with Support: the customer had written last and was waiting on a reply from us. This is elapsed time the ticket sat with us, not hands-on-keyboard effort — a ticket left untouched overnight still accrues active time. The only bucket the headline metric counts.",
  customerWait:
    "Ticket open, but Support replied last: we were waiting on the customer to answer, confirm, or send more detail. Ends the moment the customer writes back, or when the ticket is closed.",
  engWait:
    "Ticket open with a Linear issue pending: Support had escalated and was waiting on Lovable engineering, not on the customer. Carved out of customer wait, because the customer was really waiting on us. Ends when the Linear issue is done or cancelled.",
  closed:
    "The ticket was closed and later reopened — this is the gap between the close and the reopen. Nobody owed a reply during it, so it is excluded from the headline metric. Tickets that were never reopened have zero here.",
};

/** One-line plain-English definitions, shown under each bucket in the UI. */
export const SPLIT_DESC: Record<SplitKey, string> = {
  active: "Open, customer replied last — waiting on Support.",
  customerWait: "Open, Support replied last — waiting on the customer.",
  engWait: "Open with a Linear issue pending — waiting on Lovable engineering.",
  closed: "Gap between a close and a reopen — nobody owed a reply.",
};

/** Tailwind classes for the split, in a fixed order so every surface matches. */
export const SPLIT_CLASS: Record<SplitKey, string> = {
  active: "bg-primary",
  customerWait: "bg-muted-foreground/30",
  engWait: "bg-[#E66FD2]",
  closed: "bg-muted-foreground/15",
};

export type ResolutionSplit = Record<SplitKey, number> & { window: number };

/**
 * The four-way split for one row, or null when the engine never stamped it.
 * Never fabricates a bucket: a row missing `resolution_window_s` is excluded
 * from the split entirely rather than counted as all-active.
 */
export function rowSplit(r: ResolutionRow): ResolutionSplit | null {
  const w = r.resolution_window_s;
  if (typeof w !== "number") return null;
  const active = typeof r.resolution_active_s === "number" ? r.resolution_active_s : null;
  const cust = typeof r.resolution_customer_wait_s === "number" ? r.resolution_customer_wait_s : null;
  const eng = typeof r.resolution_eng_wait_s === "number" ? r.resolution_eng_wait_s : null;
  const closed = typeof r.resolution_closed_s === "number" ? r.resolution_closed_s : null;
  if (active == null || cust == null || eng == null || closed == null) return null;
  return { active, customerWait: cust, engWait: eng, closed, window: w };
}

export type SplitSummary = {
  /** Summed seconds per bucket across every row that carried a full split. */
  totals: ResolutionSplit;
  /** Rows that contributed to `totals`. */
  n: number;
  /** Finalized rows the engine never stamped with a window — excluded, not zeroed. */
  noSplit: number;
  /** Share of the summed window per bucket, 0-100. Null when the window is 0. */
  share: Record<SplitKey, number | null>;
};

/** Aggregate the split over a set of rows. Sum-then-share, never mean-of-shares. */
export function summarizeSplit(rows: ResolutionRow[]): SplitSummary {
  const totals: ResolutionSplit = { active: 0, customerWait: 0, engWait: 0, closed: 0, window: 0 };
  let n = 0;
  let noSplit = 0;
  for (const r of rows) {
    const s = rowSplit(r);
    if (!s) {
      if (r.lifecycle_status === "finalized") noSplit++;
      continue;
    }
    totals.active += s.active;
    totals.customerWait += s.customerWait;
    totals.engWait += s.engWait;
    totals.closed += s.closed;
    totals.window += s.window;
    n++;
  }
  const share = Object.fromEntries(
    SPLIT_KEYS.map((k) => [k, totals.window > 0 ? (totals[k] / totals.window) * 100 : null]),
  ) as Record<SplitKey, number | null>;
  return { totals, n, noSplit, share };
}

/** Per-bucket medians across rows carrying a full split. */
export function splitMedians(rows: ResolutionRow[]): Record<SplitKey, number | null> {
  const cols: Record<SplitKey, number[]> = { active: [], customerWait: [], engWait: [], closed: [] };
  for (const r of rows) {
    const s = rowSplit(r);
    if (!s) continue;
    for (const k of SPLIT_KEYS) cols[k].push(s[k]);
  }
  const med = (xs: number[]): number | null => {
    if (!xs.length) return null;
    const a = [...xs].sort((x, y) => x - y);
    const m = a.length >> 1;
    return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
  };
  return Object.fromEntries(SPLIT_KEYS.map((k) => [k, med(cols[k])])) as Record<SplitKey, number | null>;
}

export const SPLIT_FOOTNOTE =
  "The four-way split reads the persisted resolution_active_s / _customer_wait_s / _eng_wait_s / _closed_s columns, which the engine guarantees sum to resolution_window_s. Only Active is a headline metric; the other three explain where the remaining elapsed time went.";
