

## Replace "Resolved with time data" with Open Cases Count

### What changes

**1. `src/pages/Stats.tsx`**

The third resolution stats card (line 528-532) currently shows `resolutionStats.count` with label "Resolved with time data". Replace it with the count of open (active + awaiting_context) conversations from the already-computed `stats` object.

- Change the icon from `ThumbsUp` (green) to something like `AlertCircle` or `Activity` (orange/amber)
- Change the value from `resolutionStats.count` to `stats.active + stats.awaiting` (both already computed at line 154-155)
- Change the label to "Open cases"
- This card should render independently of `resolutionStats` being non-null, so move it outside the `resolutionStats &&` conditional block — or keep it inside but use the `stats` values

### Summary
- 1 file changed, ~5 lines modified
- No database or edge function changes

