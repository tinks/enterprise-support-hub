/**
 * Plan tier (Enterprise vs Self-serve Enterprise) as a shared reporting dimension.
 *
 * `plan_tier` is written at ingest from the Intercom inbox the conversation
 * landed in (`supabase/functions/_shared/v3-inboxes.ts`): the primary inbox maps
 * to 'enterprise', `settings.sse_intercom_inbox_id` maps to 'sse'. Rows with a
 * null/unknown value are treated as 'enterprise' so historical data keeps its
 * meaning.
 *
 * Commitment difference (see BUILTIN_SSE_POLICY in useSlaBatch):
 *  - enterprise: first-response SLA + 30 min triage target
 *  - sse:        NO first-response SLA, 60 min triage target
 */

export type PlanTier = "enterprise" | "sse";
export type PlanScope = "all" | PlanTier;

export const PLAN_LABEL: Record<PlanScope, string> = {
  all: "All plans",
  enterprise: "Enterprise inbox",
  sse: "Self-serve Enterprise inbox",
};

export const PLAN_SHORT: Record<PlanTier, string> = {
  enterprise: "Enterprise",
  sse: "SSE",
};

/** Normalize a raw `plan_tier` column value. Unknown/null => 'enterprise'. */
export function planTierOf(v: unknown): PlanTier {
  return String(v ?? "") === "sse" ? "sse" : "enterprise";
}

/** True when a row belongs in the given scope. */
export function inPlanScope(v: unknown, scope: PlanScope): boolean {
  return scope === "all" || planTierOf(v) === scope;
}

/** Scope suffix for CSV / narrative / Slack exports. */
export function planScopeNote(scope: PlanScope): string {
  return scope === "all"
    ? `${PLAN_LABEL.all} (Enterprise + Self-serve Enterprise)`
    : `${PLAN_LABEL[scope]} only`;
}
