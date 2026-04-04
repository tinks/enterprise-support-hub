

## Merge Combined activity into Overview section

### What changes
Move all content from the "Combined activity" section (lines 1377-1522) into the existing "Overview" section (lines 935-957), placing it after the two existing KPI cards. Then delete the now-empty "Combined activity" section. The title stays "Overview".

### Implementation

**`src/pages/Stats.tsx`**

1. **Expand the Overview section** (after the closing `</div>` of the KPI grid at line 956): Insert the following blocks currently in Combined activity:
   - Avg/day KPI card (add to the existing grid as a 3rd card)
   - Conversation volume area chart
   - Activity by hour of day bar chart
   - Activity heatmap

2. **Delete the Combined activity section** (lines 1377-1522) — heading, separator, and all four cards/charts.

3. No data/logic changes needed — same variables (`mergedVolumeData`, `hourlyActivityData`, `heatmapData`, `stats.avgPerDay`) are used.

### Files to edit
- `src/pages/Stats.tsx`

