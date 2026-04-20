

## Add Intercom to "Activity by hour of day" heatmap

### What I found
In `src/pages/Stats.tsx`, the heatmap currently aggregates activity from Slack mappings, Gmail conversations, and `filteredManual` rows. Since `filteredManual` already contains both `manual` and `intercom` source rows (depending on filter), Intercom may already be partially counted — but if it's broken out as its own series (like the volume chart now does), it's missing.

### Plan
1. Locate the heatmap data memo in `Stats.tsx` (the `useMemo` that builds hour-of-day aggregation).
2. Add Intercom rows (`filteredManual.filter(m => m.source === 'intercom')`) as a contributing source, ensuring its `created_at` timestamps are bucketed into the correct hour.
3. If the heatmap is rendered per-source (stacked or grouped), add an Intercom series with the amber `#F59E0B` color used elsewhere.
4. If it's a single combined heatmap, just ensure Intercom rows are included in the totals (likely already the case via `filteredManual`).
5. Respect the `sourceFilter` so Intercom is only shown when filter is `all` or `intercom`.

### Files
- Edit: `src/pages/Stats.tsx`

### Open question
Is the heatmap currently a **single combined view** of all sources, or **per-source breakdown**? I'll inspect first to confirm whether this needs a new series or just an inclusion fix.

