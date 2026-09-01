## Technical detail

No migration needed — `plan_tier` already exists on `intercom_tickets_v3`, is set from the inbox at ingest (`_shared/v3-inboxes.ts`), and both policy paths already resolve (`BUILTIN_SSE_POLICY`, `resolveForAnchor(anchor, planTier)`).

**Shared pieces (new)**
- `src/components/PlanScopeSelect.tsx` — the selector, extracted from `MonthlyLookback.tsx`.
- `src/lib/planTier.ts` — `PLAN_LABEL`, `inPlan(row, scope)`, and a `PlanBadge` cell so Inbox v3, Triage, Deep search, and owner dashboards render the badge identically.
- `MonthlyLookback.tsx` switches to the shared pieces; behavior unchanged.

**Per-surface work**
- `InboxV3.tsx` — add `plan_tier` to the row type, a Plan column with sortable header (`useTableSort`), and a plan filter applied in the existing `filtered` memo across active/finalized/transferred.
- `SlaReport.tsx`, `SlaWorkbench.tsx`, `SlaDashboard.tsx` — select `plan_tier`, add the scope selector defaulting to `enterprise`, filter the population, and render the "no SLA commitment" note in place of first-response panels when scope is `sse`.
- `CsatReport.tsx`, `TrendReport.tsx`, `AnalyticsV3.tsx`, `ResolutionAnatomy.tsx`, `OwnerDashboardV3.tsx` — select `plan_tier`, scope selector defaulting to `all`, plus a plan mix breakdown line.
- `DeepSearch.tsx` — carry `plan_tier` into `esh_search_index` meta so results can badge plan without a second query; requires a refresh of the index rows for the v3 kind.
- `actionSignals.ts` — remove `SUPPRESS_SSE`; per-signal plan filters as described; new `sse_triage_risk` signal computed with `resolveForAnchor(now, "sse")`, falling back to 3600s.
- Every CSV/narrative export gains the active scope in its header line.

**Verification before calling it done**
- Row counts per scope reconcile: enterprise + SSE = all, on each report, checked against `select plan_tier, count(*)` for the same window.
- The three existing SSE tickets appear under SSE scope and disappear under Enterprise scope on each surface.
- SSE scope on the SLA report shows the no-commitment note, not 0% compliance.
- Action Center: SSE triage risk fires against a synthetic past-target case, and first-response risk still ignores SSE. Any branch not exercised gets called out as UNVERIFIED.

**Docs pass**, per convention: `.lovable/project-knowledge.md` staged via `sync-knowledge-pending`, a `changelog_entries` row, and a FlowDiagram node for the plan-aware reporting and alerting change.
