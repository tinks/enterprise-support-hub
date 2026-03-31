

## Add day-of-week × hour-of-day heatmap to Stats page

### Overview
Add a heatmap grid below the existing "Activity by hour of day" bar chart showing activity intensity across 7 days (Mon–Sun) × 24 hours (00–23) in CET. Each cell is color-coded by combined Slack + Gmail count.

### Changes

**File: `src/pages/Stats.tsx`**

1. **New `useMemo` — `heatmapData`**: Reuse the same `getCETHour` helper. Build a 7×24 grid where each cell has `{ day, hour, slack, gmail, total }`. Day of week extracted via `toLocaleDateString("en-GB", { timeZone: "Europe/Berlin", weekday: "short" })`.

2. **New card** — placed directly after the hourly bar chart card (~line 932). Renders a CSS grid (7 rows × 24 columns) with:
   - Column headers: 00–23
   - Row headers: Mon–Sun
   - Each cell colored using an opacity scale (e.g. `bg-primary` with opacity proportional to `cell.total / maxCount`)
   - Tooltip on hover showing exact counts (Slack + Gmail breakdown)
   - Respects `sourceFilter` — sums only relevant source

3. **Styling**: Pure Tailwind — no extra dependency. Cells are small squares with rounded corners. Uses `title` attribute for simple hover info (no Recharts needed).

**File: `src/pages/FlowDiagram.tsx`**
- Add note documenting the heatmap under analytics.

### Technical detail

```ts
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const heatmapData = useMemo(() => {
  const grid: Record<string, Record<number, { slack: number; gmail: number }>> = {};
  DAYS.forEach(d => { grid[d] = {}; for (let h = 0; h < 24; h++) grid[d][h] = { slack: 0, gmail: 0 }; });
  
  const getCET = (dateStr: string) => {
    const d = new Date(dateStr);
    const day = d.toLocaleDateString("en-GB", { timeZone: "Europe/Berlin", weekday: "short" });
    const hour = parseInt(d.toLocaleString("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hour12: false }));
    return { day, hour };
  };
  
  filtered.forEach(m => { const { day, hour } = getCET(m.created_at); if (grid[day]) grid[day][hour].slack++; });
  filteredGmail.forEach(g => { const { day, hour } = getCET(g.received_at || g.created_at); if (grid[day]) grid[day][hour].gmail++; });
  return { grid, max: /* compute max total across all cells */ };
}, [filtered, filteredGmail]);
```

Rendering: simple nested `div` grid with inline `opacity` or `backgroundColor` based on intensity.

### Files to edit
- `src/pages/Stats.tsx` — heatmap memo + card
- `src/pages/FlowDiagram.tsx` — document the heatmap

