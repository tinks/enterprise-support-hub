

## Fix remaining off-brand green colours in Stats charts

### Problem
The `chartConfig.resolved` colour is still `hsl(142 76% 36%)` (green), which flows into the **Status distribution pie**, **Daily outcomes bar chart**, and the **Cumulative trend**. Several KPI card icons also use `text-green-600`. These don't match the Lovable palette.

### Colour updates

| Element | Current | New |
|---------|---------|-----|
| `chartConfig.resolved.color` | `hsl(142 76% 36%)` (green) | `#9B87F5` (purple) |
| ThumbsUp icon (Gmail resolved card, ~line 742) | `text-green-600` | `text-[#9B87F5]` |
| ThumbsUp icon (Slack resolved card, ~line 760) | `text-green-600` | `text-[#9B87F5]` |
| TrendingDown icon (escalation rate, ~line 1158) | `text-green-600` | `text-[#9B87F5]` |

### Downstream effects (no extra edits needed)
These charts already reference `chartConfig.resolved.color`, so updating line 49 fixes them automatically:
- **Daily outcomes** stacked bar (`fill={chartConfig.resolved.color}`)
- **Status distribution** pie (`pieData` uses `chartConfig.resolved.color`)

### File to edit
- `src/pages/Stats.tsx` — 4 spot changes (1 config line + 3 icon classes)

