## Technical detail

**New table** — `public.esh_trend_notes`

| column | purpose |
| --- | --- |
| `metric_key` (PK) | `total`, `closed`, `resolved_pct`, `csat`, `avg_resolve`, `median_resolve`, `backlog`, `reopened` |
| `note_text` | the Notes cell |
| `updated_by`, `updated_at` | attribution |

RLS: read for authenticated, write gated by `can_edit()`, matching the pattern used by `sla_violation_overrides` and `dev_escalations`. GRANTs issued in the same migration.

**New page** — `src/pages/TrendReport.tsx`, route `/trend-report`, added to the Reports group in `src/components/AppLayout.tsx` (same group as SLA Report, line 40).

**Data path** — one paged query over `intercom_tickets_v3` covering the whole window, then all months bucketed client-side. This reuses the exact filters Analytics v3 applies (`effectiveRsa`, customer key) so the two pages can't drift. The `median` / `percentile` helpers already in `AnalyticsV3.tsx` move into a shared module rather than being copied.

Backlog-at-month-end needs rows that were open during earlier months but are finalized now, so the query window starts at the earliest month rather than at each month boundary — one fetch, not six.

**Controls** — months (3–12, default 6), customer filter, Exclude RSA = false. Same three controls as Analytics v3, same semantics.

**Copy as Notion table** — serialises the whole grid, notes included, as a markdown table on the clipboard, so pasting into Notion recreates the page instead of you re-typing it.

**Chart** — a compact multi-line chart above the table showing total, closed, and backlog by month, so direction is visible before you read the numbers. Resolution times get their own small chart since their scale is different.

**Documentation** — `.lovable/project-knowledge.md` updated through `sync-knowledge-pending`, a `changelog_entries` row, and a FlowDiagram node for the new page and table.
