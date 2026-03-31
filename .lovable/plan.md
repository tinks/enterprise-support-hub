

## Fix heatmap filter showing empty results

### Problem
When clicking a heatmap cell, the Conversations page only loads the 50 most recent rows per source. If the clicked day+hour corresponds to older data outside that window, the filter returns zero matches.

### Solution
When heatmap query params (`day` + `hour`) are present, skip pagination and load **all** rows for that specific day+hour using a server-side filter instead of client-side filtering.

### Changes

**`src/pages/Conversations.tsx`**

1. **Detect heatmap mode early**: Check if `paramDay` and `paramHour` are set before calling `loadData`.

2. **New `loadHeatmapData` function**: When heatmap params are present, compute the date range for the target day+hour in CET, then query both tables with `.gte()` / `.lt()` filters on the timestamp columns scoped to the matching UTC window. This avoids loading all data — just the rows for that hour across all matching weeks.

   - Convert the target weekday + hour (CET) into a set of UTC time windows (since CET is UTC+1 or UTC+2 depending on DST, use the browser's `Intl` API to compute the offset).
   - Simpler approach: load a generous range (e.g., last 90 days with no pagination limit of 1000) and filter client-side. Since the heatmap on Stats already aggregates the same data, this is consistent.

3. **Revised approach (simplest)**: When heatmap params are present, load up to 1000 rows per source (no pagination) instead of 50. This matches the Stats page's own data window. Remove the `.range()` call and use `.limit(1000)`.

4. **In `useEffect`**: Branch on whether heatmap params exist to call the right loader.

5. **Hide "Load more" button** when in heatmap-filtered mode since all relevant data is already loaded.

### Technical detail
```ts
// In loadData, when heatmap params present:
const limit = (paramDay !== null && paramHour !== null) ? 1000 : 50;

// Queries use .limit(limit) instead of .range(offset, offset + 49)
// On initial load with heatmap params, skip pagination entirely
```

### Files to edit
- `src/pages/Conversations.tsx` — increase load limit when heatmap filter active
- `src/pages/FlowDiagram.tsx` — document the change

