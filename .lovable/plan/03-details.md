## Technical details

**New files**
- `src/pages/OwnerDashboardV3.tsx` — reads `useParams().owner`, one query against `intercom_tickets_v3` (owner `ilike` route param, `intercom_created_at >= CLEAN_DATA_START_ISO`, `lifecycle_status <> 'transferred_out'`, limit 2000), split client-side into Active / Closed tabs. Renders `IssueTable` with columns from `src/components/issues/issueColumns.tsx` (`idColumn`, `subjectColumn` with `subject_override` display, `contactColumn`, `customerColumn`) plus per-tab extras: Active adds age; Closed adds product area, classification, tags, CSAT, resolve time. Row click → `IssueDetailSheet` (read-only, no `TicketFieldsPanel`).

**Edits**
- `src/App.tsx` — add route `/my-v3/:owner`.
- `src/components/AppLayout.tsx` — add a "Dashboards (v3)" group in the existing flyout, driven by the same `useDashboardTeammates()` hook with a `/my-v3/` prefix. Note: `Tejas` owns 41 v3 tickets but is not in the current flyout roster; if he should appear, that's a `teammates.show_dashboard` data change, not code.

**Not touched**
`Conversations.tsx`, `OwnerDashboard.tsx`, `/my/:owner`, legacy tables, any sync function or migration. No schema change is needed — every column this reads already exists.

**Follow-ups after your review**
- `.lovable/project-knowledge.md` via `sync-knowledge-pending`, a `changelog_entries` row, and a FlowDiagram node.
- Verification will be a per-owner count comparison (v3 vs legacy) plus a wide-viewport screenshot; I'll report both, and label anything I can't run as UNVERIFIED.
