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
