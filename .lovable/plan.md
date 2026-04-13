

## Exclude cancelled conversations from analytics

### Problem
Cancelled conversations are included in all analytics metrics — totals, charts, resolution rates, volume data — inflating numbers with conversations that shouldn't count.

### Solution
Filter out `status === "cancelled"` from all three data sources (`filtered`, `filteredGmail`, `filteredManual`) early, so every downstream metric, chart, and KPI automatically excludes them.

### Changes

**`src/pages/Stats.tsx`**
- In the `filtered` memo (~line 187): add `&& m.status !== "cancelled"` to the filter
- In the `filteredGmail` memo (~line 207): add `&& g.status !== "cancelled"` to the filter
- In the `filteredManual` memo (~line 236): add `&& m.status !== "cancelled"` to the filter
- Remove the cancelled KPI card (~line 1133-1138)
- Remove `cancelled` from `chartConfig`, `volumeData`, `dailyOutcomes`, pie chart data, and the daily outcomes bar chart
- Clean up the now-unused `stats.cancelled` calculation

### Files to edit
- `src/pages/Stats.tsx`

