## Goal
Replace the three stacked card grids (Slack / Gmail / Intercom) on the Insights → Report tab with a single compact comparison table so all three sources can be scanned side-by-side.

## Proposed layout

One `Card` titled "Source performance · {Month}" containing a single table:

```
Metric                          Slack     Gmail     Intercom
─────────────────────────────────────────────────────────────
Received                        123       45        87
Resolved                        110       40        80
Open                            13        5         7
Escalated to human              8         —         —
Success rate                    89%       89%       —
Bot success rate                72%       —         —
Median first response           —         —         12m  ▼ 3m
Median response time            —         —         28m  ▲ 5m
Median resolution / time-close  4h 12m    6h 30m    2h 10m ▼ 14m
Average resolution              5h 02m    7h 15m    —
```

- Rows where a metric doesn't apply to a source render as `—` (muted).
- Right-aligned numeric columns; left-aligned metric label.
- Intercom column keeps the small green/red delta chip (vs previous month) inline next to the value.
- Footer line under the table: "Live from Intercom · {n} conversations this month vs {n} previous month" (only when Intercom data loaded). Loading / error states render as a single-row state inside the table body.
- Sticky-ish header style consistent with other tables in the app (`<Table>` / `<TableHeader>` from `components/ui/table.tsx`).

## Files

### Edited
- `src/pages/insights/MonthStatsCards.tsx` — replace the three `<section>` blocks + `Kpi` / `DeltaCard` JSX with a single table. Keep all existing data sources untouched: `computeSlackStats`, `computeGmailStats`, the `intercom-month-stats` invoke. Drop the now-unused `Kpi` / `DeltaCard` helpers and the lucide icons that were only used by them; keep `ArrowDown` / `ArrowUp` for the Intercom delta chip.
- `.lovable/memory/features/month-stats-cards.md` — update description from "three KPI sections" to "single comparison table with one row per metric and one column per source".

### Untouched
- No backend / edge function changes.
- No new files.
- No change to data computation logic, only presentation.

## Out of scope
- No new metrics, no removed metrics — same data set, new layout.
- No CSV export, no sorting, no per-source drilldown.
