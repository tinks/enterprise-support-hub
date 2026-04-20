
## Fix the conversation volume colors for Manual entry vs Intercom

### What I found
In `src/pages/Stats.tsx`, the top “Conversation volume” chart still groups both manual entries and Intercom tickets into a single `manual` series:

- `filteredManual` includes both manual and Intercom depending on source filter
- `manualVolumeData` is built from that combined set
- `mergedVolumeData` only exposes `slack`, `gmail`, and `manual`
- the chart renders one teal area for both manual and Intercom

That is why the visuals look the same there, even though the dedicated Intercom section already uses a different color.

### Plan
1. Split the overview volume data into two separate series:
   - `manualOnlyVolumeData` for rows where `source !== 'intercom'`
   - `intercomVolumeData` for rows where `source === 'intercom'`

2. Update `mergedVolumeData` so each day includes:
   - `slack`
   - `gmail`
   - `manual`
   - `intercom`

3. Add a dedicated Intercom color to `chartConfig`
   - keep Manual entry as teal
   - keep Intercom as a clearly different color already used in its section, or another distinct hue if needed
   - use the same label naming so tooltips/legend text stay clear

4. Update the “Conversation volume” chart rendering
   - keep Slack and Gmail unchanged
   - render Manual and Intercom as separate `<Area>` series with different gradients/strokes
   - when `sourceFilter === "manual"`, show only Manual entry
   - when `sourceFilter === "intercom"`, show only Intercom
   - when `sourceFilter === "all"`, show both

5. Keep scope tight
   - only change the conversation volume graph, since that is the issue reported
   - no backend/database work needed

### Files to edit
- `src/pages/Stats.tsx`
- optionally `mem://ui/analytics-dashboard` to note that the overview volume chart now shows Manual entry and Intercom as separate colored series

### Expected result
On the conversation volume graph:
- Manual entry and Intercom will no longer share the same color
- both will be visually distinguishable in “All sources”
- filtering to Intercom will show only the Intercom-colored series
