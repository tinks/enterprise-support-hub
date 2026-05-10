## Add Refresh button to Insights → Report tab

### What
Add a "Refresh" button visible only on the Report tab that re-fetches the month's tickets so freshly corrected classifications show up immediately.

### How
1. Add a `refreshKey` (number) to `useMonthData(month)` — bump it to force re-fetch. Update the hook signature to `useMonthData(month, refreshKey?)` and include it in the effect deps. Existing callers unaffected.
2. In `src/pages/Insights.tsx`:
   - Add `reportRefreshKey` state and pass it to `useMonthData`.
   - Render a small "Refresh" button (ghost/outline, with `RefreshCw` icon) inside the `ReportTab` panel header area, or alongside the existing top-right controls but only when `report` tab is active.
   - On click: bump `reportRefreshKey`. Show spinning icon while `monthData.loading`.

### Scope
Frontend only. No backend or schema changes.
