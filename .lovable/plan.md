

## Click-through from conversation volume chart to inbox

### What changes

**1. `src/pages/Stats.tsx`** — Make the volume chart clickable

Add an `onClick` handler to the `<AreaChart>` that navigates to `/conversations?day=YYYY-MM-DD&source=<current source filter>` when a data point is clicked. The `mergedVolumeData` already contains a `date` field (e.g. `2025-04-07`) which maps directly to the query param.

```tsx
<AreaChart
  data={mergedVolumeData}
  onClick={(state) => {
    if (state?.activePayload?.[0]) {
      const date = state.activePayload[0].payload.date;
      navigate(`/conversations?day=${date}&source=${sourceFilter}`);
    }
  }}
  style={{ cursor: "pointer" }}
>
```

**2. `src/pages/Conversations.tsx`** — Support day-only filtering (no hour required)

Currently the heatmap filter requires both `day` and `hour` params. Add support for day-only:

- Around line 870, add a branch: if `paramDay !== null && paramHour === null`, filter rows where the date portion of `sortDate` matches `paramDay` (simple `startsWith` or `format` check).
- Around line 1370, add a banner for the day-only filter mode showing "Showing conversations for **Apr 07, 2025**" with "Back to stats" and "Clear filter" buttons.

**3. `src/pages/FlowDiagram.tsx`** — Document the new drill-down from volume chart.

### Files to edit
- `src/pages/Stats.tsx` — add onClick to AreaChart
- `src/pages/Conversations.tsx` — support day-only param filtering + banner
- `src/pages/FlowDiagram.tsx` — document the feature

