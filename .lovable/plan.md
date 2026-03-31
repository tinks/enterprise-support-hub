

## Make heatmap cells clickable to filter conversations

### Approach
When a user clicks a heatmap cell, navigate to `/conversations` with query params encoding the day and hour. The Conversations page reads these params and filters its unified list to only show rows matching that CET day+hour.

### Changes

**`src/pages/Stats.tsx`**
- Import `useNavigate`
- Add `onClick` handler to each heatmap cell div: navigates to `/conversations?day=Mon&hour=14&source=slack` (or `all`/`gmail` based on current `sourceFilter`)
- Add `cursor-pointer` class to cells with `val > 0`

**`src/pages/Conversations.tsx`**
- Read `day`, `hour`, `source` from `useSearchParams`
- When present, filter the unified rows to only those whose CET day-of-week and hour match
- Show an active filter banner at the top with a clear button (resets search params)
- Set sourceFilter from the `source` param if provided
- Reuse the same `getCET` helper (extract day + hour in Europe/Berlin timezone)

**`src/pages/FlowDiagram.tsx`**
- Document the clickable heatmap → conversations filter interaction

### Technical detail
```ts
// Stats.tsx cell onClick
onClick={() => {
  if (val > 0) navigate(`/conversations?day=${day}&hour=${h}&source=${sourceFilter}`);
}}

// Conversations.tsx filter
const getCET = (dateStr: string) => {
  const d = new Date(dateStr);
  return {
    day: d.toLocaleDateString("en-GB", { timeZone: "Europe/Berlin", weekday: "short" }),
    hour: parseInt(d.toLocaleString("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hour12: false })),
  };
};
// Filter unified rows where getCET(sortDate).day === paramDay && getCET(sortDate).hour === paramHour
```

