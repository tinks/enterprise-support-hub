

## Update project knowledge with heatmap drill-down features

### What's missing
The current knowledge document (§25 Stats & analytics) documents "Activity by hour of day (CET)" but does not mention:
1. The **day-of-week × hour-of-day activity heatmap** grid
2. **Clickable heatmap cells** that navigate to `/conversations?day=...&hour=...&source=...`
3. The **Conversations page heatmap mode** — loads 1000 rows instead of 50, shows filter banner with "Back to stats" and "Clear filter" buttons, hides "Load more"

### Changes

**Database update only** — propose pending content to the `knowledge_documents` table.

Add to §25 (Stats & analytics), after the "Activity by hour of day (CET)" section:

```markdown
### Activity heatmap (day × hour)
- 7×24 grid showing combined Slack + Gmail activity by day of week (Mon–Sun) and hour (00–23) in CET
- Color intensity scales from transparent (0) to solid primary color (max cell value)
- Each cell displays its count; cells with zero activity are dimmed
- Respects the active source filter

### Heatmap drill-down
- Clicking a heatmap cell navigates to `/conversations?day={day}&hour={hour}&source={sourceFilter}`
- The Conversations page detects heatmap query params (`day` + `hour`) and enters **heatmap mode**:
  - Loads up to 1000 rows per source (instead of the default 50) to cover the full historical window
  - Filters the unified list client-side to only show rows matching the CET day and hour
  - Displays a filter banner: "Showing activity for {Day} {Hour}:00 CET"
  - Banner includes "Back to stats" (navigates to `/`) and "Clear filter" (removes query params) buttons
  - "Load more" pagination is hidden in heatmap mode
```

Also update the Flow Diagram to reflect the heatmap drill-down interaction.

### Files affected
- `knowledge_documents` table — pending content update with the new sections
- `src/pages/FlowDiagram.tsx` — add heatmap drill-down node/annotation

