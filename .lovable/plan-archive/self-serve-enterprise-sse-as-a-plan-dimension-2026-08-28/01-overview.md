## Self-serve enterprise (SSE) as a plan dimension

One population, one set of views. SSE is a **plan tier** carried on every v3 ticket, derived from which Intercom inbox the ticket is assigned to. Nothing today knows about a second inbox, so this adds a dimension rather than a second pipeline.

What SSE means operationally:
- No first-response, resolution, or cadence commitment — those render "no target", never 0%, and never enter enterprise compliance denominators.
- One triage target: 60 minutes (enterprise stays 30).
- Same tables, same tickets, same pages, with a visible plan badge and a plan filter everywhere the population is shown.

### Current state (verified)

- `settings.intercom_inbox_id` holds a **single** inbox id. `sync-v3-open`, `sync-v3-closed`, `sync-v3-gap-scan`, `reconcile-v3-open` and `_shared/v3-finalize.ts` all guard on `team_assignee_id == enterpriseInboxId` — a ticket in a second inbox is silently dropped today.
- `src/lib/slaMetrics.ts` hardcodes `ENTERPRISE_INBOX_TEAM_ID = "8484447"` as the SLA clock anchor.
- `sla_policy_versions` / `sla_policy_targets` are effective-dated only — there is no plan dimension, so every ticket resolves the same policy.
- `intercom_tickets_v3` has no plan/tier column.
- Triage grades every row against one target: `activePolicy?.triageTargetS ?? TRIAGE_TARGET_S`.

### Required input from you

The SSE Intercom team/inbox id. Until it is set the feature is inert: every existing row backfills to `enterprise` and behavior is byte-identical to today.
