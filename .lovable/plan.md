

## Show daily median instead of 7-day rolling median on resolution time trend

### What changes
Replace the 7-day rolling window median calculation with a simple per-day median, and lower the minimum threshold from 2 to 1 so every day with at least one resolved conversation appears.

### Implementation

**`src/pages/Stats.tsx`** (~lines 479-506)

Replace the `resolutionTrend` useMemo body:

```tsx
const resolutionTrend = useMemo(() => {
  const resolved = filtered
    .filter((m) => m.status === "resolved" && m.resolved_at)
    .map((m) => ({
      day: format(parseISO(m.created_at), "yyyy-MM-dd"),
      mins: differenceInMinutes(parseISO(m.resolved_at!), parseISO(m.created_at)),
    }))
    .filter((r) => r.mins >= 0);
  if (resolved.length === 0) return [];
  const byDay: Record<string, number[]> = {};
  for (const r of resolved) {
    if (!byDay[r.day]) byDay[r.day] = [];
    byDay[r.day].push(r.mins);
  }
  const days = Object.keys(byDay).sort();
  return days.map((day) => {
    const vals = byDay[day].sort((a, b) => a - b);
    const median = vals[Math.floor(vals.length / 2)];
    return { label: format(parseISO(day), "MMM dd"), resolution: Math.round(median) };
  });
}, [filtered]);
```

Also update the chart subtitle (~line 921) from `"7-day rolling median (minutes)"` to `"Daily median (minutes)"`.

### Files to edit
- `src/pages/Stats.tsx`

