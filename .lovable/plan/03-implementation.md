## What gets built

**Phase 1 — two new persisted metrics (you own the SQL)**

- Migration adds `time_to_triage_s`, `triage_set_at`, `time_to_first_human_reply_s`, `first_human_reply_at`, and `responsiveness_engine_version` to `intercom_tickets_v3`.
- `_shared/sla-core.ts` gains `computeTriage` (first admin event that sets the Severity attribute — same attribute-event scan `findLinearAttributeTs` already uses) and `computeFirstHumanReply` (first timeline part classified `human_admin`, excluding `sam_ai` and `shared_inbox`, anchored at Enterprise-inbox assignment, not conversation creation).
- `_shared/v3-finalize.ts` writes both on finalize; a backfill function fills history, same pattern as the active-clock backfill.

**Phase 2 — the shared library**

`src/lib/reportingMetrics.ts` becomes the one place each metric is defined: the population predicate (wrapping `slaExclusions` + test tickets + `transferred_out` + plan scope), the metric accessors, and their display labels and descriptions. No page re-derives.

**Phase 3 — conform the surfaces**

- `OwnerDashboardV3` — the worst offender: swap raw `time_to_resolve_s` for the active clock, and raw CSAT for the integrity-adjusted value from `csat.ts`.
- `AnalyticsV3`, `TrendReport`, `MonthlyLookback`, `CustomerReport`, `ResolutionAnatomy` — read population and labels from the library; replace the "median first reply" card with triage + human first reply.
- SLA family — unchanged in numbers, re-pointed at the library so the definitions live in one file.

**Phase 4 — verification, before anything is called done**

- Per report, per month: population counts reconcile to a single `select count(*)` under the shared predicate.
- Aug 2026 shown side by side: old vs new first-reply and resolution figures on each surface, with the deltas named.
- Negative cases: a ticket that never got a Severity set, a ticket with no human reply at all, a ticket closed by Sam alone. Any branch not exercised is called out UNVERIFIED.

**Phase 5 — doc pass**, per convention: `.lovable/project-knowledge.md` staged via `sync-knowledge-pending`, a `changelog_entries` row, and a FlowDiagram node.

## Known impact on published numbers

August's "median first reply 17m" card disappears. In its place: triage time, and human first reply anchored to Enterprise assignment (roughly 45m from creation on the same population, per the earlier audit — to be re-verified, not asserted). This is a deliberate, explained change of definition, not a regression.

Roadmap gets a "Reporting metric standard" section in the same turn so this cannot silently drop again.
