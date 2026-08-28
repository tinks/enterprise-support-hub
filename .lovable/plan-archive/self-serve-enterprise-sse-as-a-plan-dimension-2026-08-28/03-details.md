## Build order

Each step is additive and inert until the SSE inbox id is configured.

### 1. Schema (one migration)

- `settings.sse_intercom_inbox_id text null` — second inbox id, editable from Settings.
- `intercom_tickets_v3.plan_tier text not null default 'enterprise'` — every existing row backfills to `enterprise`, so nothing changes retroactively.
- `sla_policy_versions.plan text not null default 'enterprise'` — policy resolution becomes keyed on `(plan, effective_from)` instead of date alone.
- Seed one SSE policy version: no first-response / resolution / cadence target rows, `triage_target_s = 3600` on the same business-hours basis as enterprise.

Bounded: no changes to `v3_derive_customer`, the customer triggers, or any existing policy row.

### 2. Ingestion — inbox set instead of one id

`sync-v3-open`, `sync-v3-closed`, `sync-v3-gap-scan`, `reconcile-v3-open`, `_shared/v3-finalize.ts`, and `intercom-webhook` currently compare `team_assignee_id` to a single value. Each moves to a resolved list of `{ inboxId, plan }` and writes `plan_tier` from the matching entry. A ticket in neither inbox is still dropped, and a ticket moving between the two updates `plan_tier` on the next sync (the reconciler's `transferred_out` path is unchanged — moving Ent → SSE is a plan change, not a departure).

### 3. Engine (`src/lib/slaMetrics.ts`)

- `ENTERPRISE_INBOX_TEAM_ID` becomes a set of anchor team ids; the SLA clock anchors on assignment to whichever inbox owns the ticket. Enterprise behavior is unchanged.
- `resolvePolicy` takes the ticket's `plan_tier` alongside the inbound anchor.
- `evaluateCompliance` / `evaluateCadence` already return `null` for an absent target, which is exactly the "no target" render — no new branch, just an SSE policy with no rows.
- Tests: an SSE ticket scores triage only, produces `null` (not `false`) for FR/resolution/cadence, and never lands in an enterprise denominator.

### 4. Surfaces

- `useSlaBatch` carries `plan_tier` on each enriched row and resolves policy per plan.
- SLA Dashboard / Workbench / Report / What-if: a plan filter next to the existing window and customer selectors, defaulting to **Enterprise** so today's published numbers stay exactly as they are. Scorecard rows for SSE show "no target" for FR, resolution and cadence.
- Triage: per-row target from the row's plan (30m / 60m) with a small plan badge in the row.
- Inbox v3, Escalations, Action Center: plan badge on the row plus plan in the search haystack.

### 5. Docs

`.lovable/project-knowledge.md` staged via `sync-knowledge-pending` (never live), a `changelog_entries` row, and a FlowDiagram node for the dual-inbox ingestion path.

## Verification before anything is called done

- Enterprise compliance numbers for a fixed window are identical pre- and post-change (same in-scope count, same %met per severity).
- An SSE ticket appears in Triage graded at 60m and shows "no target" on all three SLA metrics.
- A ticket in neither inbox is still ignored.
- The negative case: with `sse_intercom_inbox_id` unset, the whole feature is a no-op.

Anything not covered by a run I can show stays labelled UNVERIFIED.
