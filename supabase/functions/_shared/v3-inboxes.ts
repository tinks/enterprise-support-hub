// Plan-tier / inbox resolution for the v3 pipeline.
//
// A v3 ticket belongs to exactly one plan tier, derived from the Intercom
// inbox (team) it is assigned to:
//   settings.intercom_inbox_id      -> 'enterprise'
//   settings.sse_intercom_inbox_id  -> 'sse'  (self-serve enterprise)
//
// Until `sse_intercom_inbox_id` is set, this resolves to exactly the previous
// single-inbox behavior: one id, plan 'enterprise'.

export type PlanTier = "enterprise" | "sse";

export type InboxResolver = {
  /** Every inbox id the v3 pipeline ingests, in priority order. */
  ids: string[];
  /** Primary (enterprise) inbox id — the historical `enterpriseInboxId`. */
  primaryId: string;
  /** SSE inbox id, or null when not configured. */
  sseId: string | null;
  /** Plan for a team id; null when the team is not one of ours. */
  planFor: (teamId: unknown) => PlanTier | null;
  /** True when the team id is one of our ingested inboxes. */
  isOurs: (teamId: unknown) => boolean;
};

export function resolveInboxes(settings: {
  intercom_inbox_id?: string | null;
  sse_intercom_inbox_id?: string | null;
}): InboxResolver {
  const primaryId = String(settings?.intercom_inbox_id ?? "").trim();
  const sseRaw = String(settings?.sse_intercom_inbox_id ?? "").trim();
  const sseId = sseRaw && sseRaw !== primaryId ? sseRaw : null;
  const ids = [primaryId, ...(sseId ? [sseId] : [])].filter(Boolean);

  const planFor = (teamId: unknown): PlanTier | null => {
    const t = String(teamId ?? "").trim();
    if (!t) return null;
    if (t === primaryId) return "enterprise";
    if (sseId && t === sseId) return "sse";
    return null;
  };

  return {
    ids,
    primaryId,
    sseId,
    planFor,
    isOurs: (teamId: unknown) => planFor(teamId) != null,
  };
}

/**
 * Intercom conversation-search clause matching any of our inboxes.
 * One inbox -> a plain `=` clause (byte-identical to the previous query).
 */
export function inboxSearchClause(ids: string[]): Record<string, unknown> {
  const nums = ids.map((id) => parseInt(id)).filter((n) => Number.isFinite(n));
  if (nums.length === 1) {
    return { field: "team_assignee_id", operator: "=", value: nums[0] };
  }
  return {
    operator: "OR",
    value: nums.map((n) => ({ field: "team_assignee_id", operator: "=", value: n })),
  };
}
