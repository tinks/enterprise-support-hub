

## Update Stats Labels and Add Cancelled Data

### Changes to `src/pages/Stats.tsx`

**1. Rename "Escalated" to "Escalated to human"**
- Update `chartConfig.escalated.label` from `"Escalated"` to `"Escalated to human"`
- Update the summary card label (line 490) from `"Escalated"` to `"Escalated to human"`
- Update pie chart name (line 224) from `"Escalated"` to `"Escalated to human"`
- Update chart description (line 646) to `"Resolved vs escalated to human per day"`

**2. Include cancelled conversations in stats**
- Remove the `notCancelled` filter (line 145-146) so cancelled conversations are included in the dataset
- Add `cancelled` count to the `stats` memo: `const cancelled = filtered.filter((m) => m.status === "cancelled").length;`
- Add `cancelled` to the `chartConfig` with a muted/gray color
- Add a new summary card for "Cancelled" with an `XCircle` icon
- Add cancelled slice to the pie chart data
- Optionally add cancelled to daily volume data

### Summary
- 1 file changed (`Stats.tsx`)
- ~15 lines modified across label renames and cancelled data additions

