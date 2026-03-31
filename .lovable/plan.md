

## Add "Activity by hour of day" chart to Stats page

### Overview
Add a bar chart showing the distribution of activity by hour of day (in CET timezone) combining both Gmail emails and Slack conversations.

### Changes

**File: `src/pages/Stats.tsx`**

1. **New `useMemo` — `hourlyActivityData`**: Iterate over `filtered` (Slack) and `filteredGmail` (Gmail), extract the hour of day in CET (Europe/Berlin, UTC+1/+2) from `created_at` / `received_at`, and bucket into 24 slots (0–23). Each slot has `{ hour: "08:00", slack: N, gmail: N }`.

2. **New chart card** — placed after the "Conversation volume" card and before "Conversations by channel". Shows a grouped `BarChart` with hours 00–23 on X-axis and stacked/grouped bars for Slack (blue) and Gmail (amber). Visible when `sourceFilter` is "all", "slack", or "gmail" (hides the irrelevant series). Title: "Activity by hour of day (CET)".

3. **CET conversion**: Use `toLocaleString("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hour12: false })` to extract the CET hour from each timestamp — no extra dependency needed.

**File: `src/pages/FlowDiagram.tsx`**
- Add a note documenting the hourly activity chart under analytics.

### Technical detail

```ts
const hourlyActivityData = useMemo(() => {
  const buckets = Array.from({ length: 24 }, (_, i) => ({
    hour: `${String(i).padStart(2, "0")}:00`,
    slack: 0,
    gmail: 0,
  }));
  const getCETHour = (dateStr: string) => {
    const d = new Date(dateStr);
    return parseInt(d.toLocaleString("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hour12: false }));
  };
  filtered.forEach(m => { buckets[getCETHour(m.created_at)].slack++; });
  filteredGmail.forEach(g => { buckets[getCETHour(g.received_at || g.created_at)].gmail++; });
  return buckets;
}, [filtered, filteredGmail]);
```

### Files to edit
- `src/pages/Stats.tsx` — add hourly activity memo + chart card
- `src/pages/FlowDiagram.tsx` — document the new metric

