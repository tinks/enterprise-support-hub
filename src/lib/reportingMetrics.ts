// THE reporting metric standard for the Hub.
//
// Every report imports its population predicate and its metric accessors from
// here. No page may re-derive a metric locally: two surfaces that both say
// "resolution time" must read the same field through the same function, or the
// numbers drift and the reports stop being trustable.
//
// Three layers (approved 2026-09-03):
//   1. POPULATION   — one definition of "counts as an Enterprise ticket".
//   2. RESPONSIVENESS — time to triage, time to first HUMAN reply. Persisted by
//      the SLA engine (`_shared/sla-core.ts` computeResponsiveness), anchored at
//      the SLA clock start, never counting Sam/bots.
//   3. RESOLUTION   — the persisted four-way clock. Raw wall clock is demoted.
//
// Volume is deliberately NOT filtered down to the SLA population: it answers
// "how much arrived", and every surface that shows it must say so.

import { inPlanScope, type PlanScope } from "./planTier";
import { isSlaExcluded, type SlaExclusionRow, type SlaExclusionOpts } from "./slaExclusions";
import { isTestTicket, type TestFlagRow } from "./testTickets";
import { median, percentile, formatDuration } from "./durationStats";

// ============================================================================
// Layer 1 — population
// ============================================================================

export type ReportingRow = TestFlagRow &
  Partial<SlaExclusionRow> & {
    plan_tier?: string | null;
    lifecycle_status?: string | null;
  };

export type PopulationOpts = {
  /** Plan scope selector state. Default 'all'. */
  scope?: PlanScope;
  /** Reveal Hub-designated test tickets (demo view). Default false. */
  showTestData?: boolean;
  /** customer_key values marked v3_customer_accounts.is_test. */
  testAccountKeys?: Set<string>;
  /**
   * Apply the SLA exclusion rules (tags, RSA override, resolution method).
   * Default true. Volume surfaces pass false and MUST label the difference.
   */
  applySlaExclusions?: boolean;
};

/** Tickets that left the Enterprise inbox are never part of any report. */
export function isTransferredOut(row: ReportingRow): boolean {
  return row.lifecycle_status === "transferred_out";
}

/** The one predicate. True when the row belongs in the report. */
export function inReportingPopulation(row: ReportingRow, opts: PopulationOpts = {}): boolean {
  if (isTransferredOut(row)) return false;
  if (!inPlanScope(row.plan_tier, opts.scope ?? "all")) return false;
  if (!opts.showTestData && isTestTicket(row)) return false;
  if (opts.applySlaExclusions === false) return true;

  const exclusionOpts: SlaExclusionOpts = {
    testAccountKeys: opts.testAccountKeys,
    showTestData: opts.showTestData,
  };
  return !isSlaExcluded(
    {
      tags: row.tags ?? null,
      rsa_override: row.rsa_override ?? null,
      customer_resolution_method: row.customer_resolution_method ?? null,
      customer_key: row.customer_key ?? null,
      is_test_ticket: row.is_test_ticket ?? null,
    },
    exclusionOpts,
  );
}

export function reportingPopulation<T extends ReportingRow>(rows: T[], opts: PopulationOpts = {}): T[] {
  return rows.filter((r) => inReportingPopulation(r, opts));
}

// ============================================================================
// Layers 2 and 3 — the metric registry
// ============================================================================

export type MetricKey =
  | "time_to_triage"
  | "time_to_first_human_reply"
  | "time_to_first_admin_reply"
  | "resolution_active"
  | "resolution_customer_wait"
  | "resolution_eng_wait"
  | "resolution_closed"
  | "resolution_window"
  | "time_to_resolve_raw";

export type MetricRow = Record<string, unknown>;

export type MetricDef = {
  key: MetricKey;
  /** Short display name. This is what a card / column header shows. */
  label: string;
  /** One sentence the surface can render as the card description or tooltip. */
  description: string;
  /** Persisted column read for this metric. */
  column: string;
  /** 'primary' is headline-eligible; 'secondary' must be labelled as context. */
  rank: "primary" | "secondary";
  layer: "responsiveness" | "resolution";
};

export const METRICS: Record<MetricKey, MetricDef> = {
  time_to_triage: {
    key: "time_to_triage",
    label: "Time to triage",
    description:
      "From Enterprise-inbox assignment until a teammate first set the Severity attribute. Null when the ticket was never triaged.",
    column: "time_to_triage_s",
    rank: "primary",
    layer: "responsiveness",
  },
  time_to_first_human_reply: {
    key: "time_to_first_human_reply",
    label: "First human reply",
    description:
      "From Enterprise-inbox assignment until the first public reply by a human teammate. Sam, bots, notes and the shared relay inbox never count.",
    column: "time_to_first_human_reply_s",
    rank: "primary",
    layer: "responsiveness",
  },
  time_to_first_admin_reply: {
    key: "time_to_first_admin_reply",
    label: "First reply (any agent)",
    description:
      "Intercom's own time_to_admin_reply, measured from conversation creation and counting Sam. Context only — not the responsiveness headline.",
    column: "time_to_first_admin_reply_s",
    rank: "secondary",
    layer: "responsiveness",
  },
  resolution_active: {
    key: "resolution_active",
    label: "Resolution time",
    description:
      "Active in-our-court time only: closed, waiting-on-customer and engineering-wait time are excluded.",
    column: "resolution_active_s",
    rank: "primary",
    layer: "resolution",
  },
  resolution_customer_wait: {
    key: "resolution_customer_wait",
    label: "Customer wait",
    description: "Time the ball was with the customer, excluding engineering wait.",
    column: "resolution_customer_wait_s",
    rank: "secondary",
    layer: "resolution",
  },
  resolution_eng_wait: {
    key: "resolution_eng_wait",
    label: "Engineering wait",
    description: "Time waiting on a linked Linear issue — looks like customer wait, is actually on us.",
    column: "resolution_eng_wait_s",
    rank: "secondary",
    layer: "resolution",
  },
  resolution_closed: {
    key: "resolution_closed",
    label: "Closed time",
    description: "Dormant time between a close and a later reopen, inside the resolution window.",
    column: "resolution_closed_s",
    rank: "secondary",
    layer: "resolution",
  },
  resolution_window: {
    key: "resolution_window",
    label: "Total window",
    description: "Clock start to last close. Active + customer wait + engineering wait + closed sum to it.",
    column: "resolution_window_s",
    rank: "secondary",
    layer: "resolution",
  },
  time_to_resolve_raw: {
    key: "time_to_resolve_raw",
    label: "Wall clock",
    description:
      "Intercom's raw time_to_last_close, counting every dormant and waiting hour. Never display this as resolution time.",
    column: "time_to_resolve_s",
    rank: "secondary",
    layer: "resolution",
  },
};

export const metricLabel = (key: MetricKey): string => METRICS[key].label;
export const metricDescription = (key: MetricKey): string => METRICS[key].description;

/** Read a metric off a ticket row. Non-numeric / missing => null, never 0. */
export function metricValue(row: MetricRow, key: MetricKey): number | null {
  const v = row[METRICS[key].column];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export type MetricAgg = {
  median: number | null;
  p90: number | null;
  avg: number | null;
  /** Rows with a value — the honest denominator. */
  n: number;
  /** Rows in the population with NO value (never triaged, no human reply, …). */
  missing: number;
};

export function aggregateMetric(rows: MetricRow[], key: MetricKey): MetricAgg {
  const values: number[] = [];
  let missing = 0;
  for (const r of rows) {
    const v = metricValue(r, key);
    if (v == null) missing++;
    else values.push(v);
  }
  const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
  return {
    median: median(values),
    p90: percentile(values, 90),
    avg,
    n: values.length,
    missing,
  };
}

export { formatDuration };

/** Columns every v3 reporting query must select to satisfy this module. */
export const REPORTING_SELECT_COLUMNS = [
  "plan_tier",
  "lifecycle_status",
  "is_test_ticket",
  "tags",
  "rsa_override",
  "customer_resolution_method",
  "customer_key",
  "time_to_triage_s",
  "time_to_first_human_reply_s",
  "time_to_first_admin_reply_s",
  "resolution_active_s",
  "resolution_customer_wait_s",
  "resolution_eng_wait_s",
  "resolution_closed_s",
  "resolution_window_s",
  "time_to_resolve_s",
].join(",");
