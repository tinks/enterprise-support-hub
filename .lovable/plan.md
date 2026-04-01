

## Add date filter to conversations tab

### What it does
Adds a date range picker (from/to) in the filter toolbar that filters conversations to only show rows within the selected date range. Works with both paginated and server-side search modes.

### Changes

**`src/pages/Conversations.tsx`**

1. Import `Calendar`, `CalendarIcon`, `Popover`, `format` from date-fns
2. Add two state variables: `dateFrom: Date | undefined` and `dateTo: Date | undefined`
3. Add two date picker popovers (from/to) in the filter toolbar next to the source and status filters, using the shadcn Calendar component inside Popover with `pointer-events-auto`
4. Add a clear button that appears when either date is set
5. In the `unified` useMemo, filter rows by checking `sortDate` falls within the from/to range (inclusive — from = start of day, to = end of day)
6. When server-side search is active (`searchResults`), apply the same date filter on the merged results
7. For the paginated data fetch (`loadData`), add `.gte("created_at", dateFrom)` and `.lte("created_at", dateTo)` to the Supabase queries when dates are set, so we don't load irrelevant rows
8. Add `dateFrom` and `dateTo` to the dependency arrays for `loadData` and `unified`

**`src/pages/FlowDiagram.tsx`** — Document that conversations tab now supports date range filtering

### Files to edit
- `src/pages/Conversations.tsx` — date state, picker UI, query + client filters
- `src/pages/FlowDiagram.tsx` — document change

