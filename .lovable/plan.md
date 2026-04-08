

## Clickable resolution distribution bars — drill into conversations

### Problem
When you see "5 conversations under 15 minutes" in the resolution time distribution chart, you can't click the bar to see which conversations those are. You want to click any bar and navigate to the conversations page filtered to just those conversations.

### Solution
Make each bar in the resolution distribution chart clickable. Clicking navigates to `/conversations` with a query param like `?resolutionBucket=0-15` (or `15-60`, `240-1440`, etc.). The Conversations page reads that param and filters to only show resolved conversations whose resolution time falls in that bucket.

### Changes

**`src/pages/Stats.tsx`**
- Add `onClick` handler to the `<Bar>` in the resolution distribution chart
- Each bucket already has a `max` value; add a `min` to each bucket too (0, 15, 60, 240, 1440)
- Include min/max in the chart data so the click handler can read it
- On click, navigate to `/conversations?resolutionMin={min}&resolutionMax={max}&source=slack`
- Add `cursor: pointer` styling to the bars

**`src/pages/Conversations.tsx`**
- Read `resolutionMin` and `resolutionMax` from search params
- When present, filter the unified list to only show Slack conversations where `resolved_at - created_at` falls within that range (in minutes)
- Need `resolved_at` in the data — already fetched for `conversation_mappings`
- Show a banner like the heatmap filter: "Showing conversations resolved in < 15m" with a clear button
- Add to the `isHeatmapMode`-style check so the banner and filtering logic work

**`src/pages/FlowDiagram.tsx`**
- Note clickable resolution distribution bars

### Technical detail

Resolution distribution buckets with min/max:
```typescript
const buckets = [
  { label: "< 15m", min: 0, max: 15, count: 0 },
  { label: "15m–1h", min: 15, max: 60, count: 0 },
  { label: "1–4h", min: 60, max: 240, count: 0 },
  { label: "4–24h", min: 240, max: 1440, count: 0 },
  { label: "24h+", min: 1440, max: 999999, count: 0 },
];
```

Click handler on BarChart:
```typescript
<BarChart data={resolutionDistribution} onClick={(state) => {
  if (state?.activePayload?.[0]) {
    const { min, max } = state.activePayload[0].payload;
    navigate(`/conversations?resolutionMin=${min}&resolutionMax=${max}&source=slack`);
  }
}} style={{ cursor: "pointer" }}>
```

Conversations filter (in unified useMemo):
```typescript
if (resolutionMin !== null && resolutionMax !== null) {
  return rows.filter(r => {
    if (r.source !== "slack") return false;
    const m = r.data as ConversationMapping;
    if (!m.resolved_at) return false;
    const mins = differenceInMinutes(parseISO(m.resolved_at), parseISO(m.created_at));
    return mins >= resolutionMin && mins < resolutionMax;
  });
}
```

### Files to edit
- `src/pages/Stats.tsx` — add min to buckets, add click handler on resolution distribution bars
- `src/pages/Conversations.tsx` — read resolution params, filter, show banner
- `src/pages/FlowDiagram.tsx` — note clickable chart bars

