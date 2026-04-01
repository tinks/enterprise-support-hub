

## Add export option to stats tab

### What it does
Adds a "Export CSV" button to the Stats page that exports the currently filtered conversation data (both Slack and Gmail) as a CSV file. The export respects all active filters (source, time range, channels, test/real view).

### Changes

**`src/pages/Stats.tsx`**

1. Import `Download` icon from lucide-react
2. Add an `exportCSV` function that:
   - Combines `filtered` (Slack) and `filteredGmail` (Gmail) into a unified array
   - Maps each row to a flat object with columns: source, date, status, channel/from, subject/message, is_test, is_bug, is_feature_request, product_area, resolved_at
   - Generates CSV string with headers and rows (escaping commas/quotes)
   - Creates a Blob download with filename including current date and filter info
3. Add a "Export CSV" `Button` with the download icon, placed next to the existing refresh button in the filter toolbar area

### Files to edit
- `src/pages/Stats.tsx` — export function + button
- `src/pages/FlowDiagram.tsx` — document the export feature

