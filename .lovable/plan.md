

## Fix Combined activity to use deduplicated Gmail thread counts

### Problem
Three places in the Combined activity section count raw Gmail rows instead of deduplicated threads:
1. **`gmailVolumeData`** (line 310-317) — counts every email row per day, inflating the stacked volume chart
2. **`hourlyActivityData`** (line 572-587) — counts every email row per hour bucket
3. **`heatmapData`** (line 591-628) — counts every email row per day×hour cell
4. **`avgPerDay`** (line 368-377) — uses `gmailTotal` (raw count) instead of `gmailDeduped`

### Approach
Deduplicate Gmail by counting only one row per unique `subject` (matching the existing KPI logic). For each Gmail grouping, track which subjects have already been counted and skip duplicates.

### Implementation

**`src/pages/Stats.tsx`**

1. **`gmailVolumeData`** (~line 310): Track seen subjects per day. Only increment the count for the first row of each subject on that day.

2. **`hourlyActivityData`** (~line 572): Track seen subjects per hour bucket. Only count one row per subject per hour.

3. **`heatmapData`** (~line 591): Track seen subjects per day×hour cell. Only count one row per subject per cell.

4. **`avgPerDay`** (~line 368): Replace `gmailTotal` with `gmailDeduped` in the `combinedTotal` calculation so the average is consistent.

5. **`mergedVolumeData`** (~line 328): Already uses `gmailVolumeData` — will automatically reflect the fix from step 1.

### Files to edit
- `src/pages/Stats.tsx`

