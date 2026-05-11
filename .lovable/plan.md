# Why "Load more" doesn't grow the visible list

In `src/pages/Conversations.tsx`:

- `loadData` fetches **50 raw rows per source** from the database (Slack/Gmail/Manual), ordered by `created_at desc`, with **no server-side filtering** for owner / status / classification / product area.
- All those filters are then applied **client-side** in the `unified` memo (lines ~990-1020).
- "Load more" calls `loadData(true)`, which fetches the **next 50 raw rows** and appends them. But if those next 50 rows don't match the active filter (e.g. owner = "Joel" on a dashboard), the visible row count doesn't change — the new rows are filtered out before render.
- Eventually `slackRows.length < 50` and `hasMore` flips to false, so the button silently disappears.
- Additionally, `manualQuery` uses `.limit(pageSize)` with no offset (line 756), so manual rows are re-fetched from the start every click and never paginate.

Net effect: clicking "Load more" appears to do nothing whenever a filter is hiding the newly fetched rows.

# Fix

Replace the broken "Load more" button with proper numbered pagination that operates on the **already-filtered** `unified` list. Pagination is purely client-side over the rows currently in memory, but we keep a background fetch so navigating near the end of loaded data pulls in more from the server automatically.

## Changes (frontend only, all in `src/pages/Conversations.tsx`)

1. **Add page state**
   - `const PAGE_SIZE = 25;`
   - `const [page, setPage] = useState(1);`
   - Reset `page` to 1 inside the existing reload effects and whenever any filter (`ownerFilter`, `productAreaFilter`, `classificationFilter`, `hiddenStatuses`, `sourceFilter`, `searchResults`, date range) changes.

2. **Derive paged rows**
   - `const totalPages = Math.max(1, Math.ceil(unified.length / PAGE_SIZE));`
   - `const pagedRows = unified.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);`
   - Render the table body over `pagedRows` instead of `unified`. The `goToConversation` `inbox:list` keeps using full `unified` (so Prev/Next on detail page still walks the full filtered list).

3. **Auto-fetch more when near the end**
   - In a `useEffect` keyed on `page`: if `canLoadMore && page >= totalPages - 1 && !loadingMore`, call `loadData(true)`. This makes the "next" button keep working when the user reaches the end of currently-loaded rows.

4. **Replace the "Load more" block (lines 2012-2018) with a `<ConversationsPagination>` helper** built on the existing `src/components/ui/pagination.tsx` primitives:
   - Previous button: hidden on page 1, otherwise sets `page - 1`.
   - Next button: hidden when `page === totalPages && !canLoadMore`, otherwise sets `page + 1`.
   - Up to 5 numbered page buttons in a sliding window centred on the current page (clamped to `[1, totalPages]`).
   - Leading ellipsis when window start > 1; trailing ellipsis when window end < totalPages.
   - Active page rendered with `bg-primary text-primary-foreground font-bold` (the contrasting brand colour from the design tokens) using `PaginationLink isActive`.

5. **Fix the manual query pagination bug** (line 756): change `manualQuery.limit(pageSize)` to `manualQuery.range(currentManualOffset, currentManualOffset + pageSize - 1)` and add a matching `manualOffset` state + `hasMoreManual` flag, mirroring how Slack/Gmail are handled. Include `hasMoreManual` in `canLoadMore`.

## Layout cases (matches the spec)

```text
First page:        [1] 2 3 4 5 …  Next
Middle page:  Prev … X X [X] X X …  Next
Last page:    Prev … X X X X [X]
```

## Out of scope

- No server-side filter pushdown (owner / status / classification stay client-side for now). The auto-fetch on near-end navigation compensates.
- No total-count query (`count: 'exact'`); `totalPages` is derived from currently loaded + filtered rows and grows as more pages are fetched.
- No changes to `OwnerDashboard.tsx`, routing, RLS, or the search-results path (search already returns the full match set).

## Verification

- Build passes.
- With an owner filter active, clicking Next repeatedly continues to reveal new rows (background fetch kicks in near the end).
- Changing any filter resets to page 1.
- First page hides Prev; last page hides Next; middle pages show both with ellipses.
- Active page number is bold and uses the primary contrast colour.
