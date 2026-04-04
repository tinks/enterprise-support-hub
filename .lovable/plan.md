

## Show daily escalation rate instead of 7-day rolling window

### What changes
Replace the 7-day rolling window escalation rate calculation with a simple per-day escalation percentage, matching the approach used for the resolution time trend.

### Implementation

**`src/pages/Stats.tsx`**

1. Replace the `escalationRateData` useMemo (~lines 376-402) with daily logic:

```tsx
const escalationRateData = useMemo(() => {
  const escalatedByDay: Record<string, number> = {};
  filtered.forEach((m) => {
    if (m.status === "escalated" || m.status === "escalated_pending") {
      const day = format(parseISO(m.created_at), "yyyy-MM-dd");
      escalatedByDay[day] = (escalatedByDay[day] || 0) + 1;
    }
  });
  return volumeData
    .filter((d) => d.resolved > 0 || (escalatedByDay[d.date] || 0) > 0)
    .map((d) => {
      const escalated = escalatedByDay[d.date] || 0;
      const total = d.resolved + escalated;
      return {
        label: d.label,
        rate: total > 0 ? Math.round((escalated / total) * 100) : 0,
      };
    });
}, [volumeData, filtered]);
```

2. Update the chart subtitle (~line 1046) from `"7-day rolling escalation % of completed conversations"` to `"Daily escalation % of completed conversations"`.

### Files to edit
- `src/pages/Stats.tsx`

