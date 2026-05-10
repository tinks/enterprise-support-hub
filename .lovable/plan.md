## Add a "Refresh" button on the Report tab

A single button in the Report tab header that re-pulls month data and (optionally) re-runs AI insights.

## Behaviour

- Button placed next to the existing month picker / "Download PDF" action in `ReportTab.tsx` header.
- Click → triggers two things in parallel:
  1. **Reload live numbers** — re-runs the `useMonthData` query for the selected month (KPIs, top accounts, owner load, sparkline, source mix).
  2. **Refresh AI insights** (only if the user holds Shift, or via a small dropdown "Refresh data" / "Refresh data + AI topics") — calls the existing `analyze-intercom-month` edge function for the selected month, then re-reads the `monthly_insights` row.
- While running: button shows a spinner and is disabled. Toast on success/failure.
- The previous-month KPI deltas also refresh (the report already calls `useMonthData` for `subMonths(current, 1)`).

## Implementation

Frontend only.

- **`src/pages/insights/useMonthData.ts`** — expose a `refresh()` function from the hook (re-runs the same effect body on demand). Keep the existing month-change auto-fetch.
- **`src/pages/insights/ReportTab.tsx`**:
  - Replace the static `useMonthData(month)` call with the new `{ ...data, refresh }` shape.
  - Add a `<Button variant="outline" size="sm">` with a `RefreshCw` icon in the header, plus a small dropdown menu offering "Refresh data" (default) and "Refresh data + AI topics".
  - "Refresh data + AI topics" calls `supabase.functions.invoke('analyze-intercom-month', { body: { month } })`, then re-reads `monthly_insights`, then `refresh()` on the hook.
  - Use `useToast` for success/failure feedback.

No backend changes — `analyze-intercom-month` already exists.

## Out of scope

- Background auto-refresh / polling.
- Refreshing CSAT from Intercom (separate cron `refresh-intercom-csat`).
