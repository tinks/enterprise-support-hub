

## Simplify "Conversations by Channel" to Total Count per Row

### What Changes

Replace the current stacked horizontal bar chart (showing status breakdown) with a simple horizontal bar chart that displays the **total number of conversations** per channel, one channel per row. Each bar shows a single value — the total count — making it easier to compare channels at a glance.

### Technical Details

**File: `src/pages/Stats.tsx`** — Lines 483-494

1. Add a `total` field to each `channelData` entry (sum of resolved + escalated + active + awaiting_context) in the data preparation logic
2. Replace the 4 stacked `<Bar>` components with a single `<Bar dataKey="total">` using the primary color
3. Add value labels at the end of each bar for quick reading

```tsx
<BarChart data={channelData} layout="vertical" margin={{ left: 20 }}>
  <CartesianGrid strokeDasharray="3 3" className="stroke-border" horizontal={false} />
  <XAxis type="number" allowDecimals={false} className="text-xs" />
  <YAxis type="category" dataKey="channel" className="text-xs" width={160} tick={{ fontSize: 12 }} />
  <ChartTooltip content={<ChartTooltipContent />} />
  <Bar dataKey="total" fill="hsl(var(--primary))" radius={[0, 4, 4, 0]}>
    <LabelList dataKey="total" position="right" className="text-xs fill-foreground" />
  </Bar>
</BarChart>
```

The status breakdown remains visible in the **Status distribution** pie chart already on the page.

