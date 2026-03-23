

## Add "Load More" Button to Conversations

### Current State
The page fetches 50 conversations with `.limit(50)` and no way to see older ones.

### Changes

**File: `src/pages/Conversations.tsx`**

1. Add `offset` state (starts at 0) and `hasMore` state (starts at true)
2. Modify `loadData` to accept an `append` flag — when true, fetch next 50 rows using `.range(offset, offset+49)` and append to existing mappings
3. Add a "Load more" button below the table that calls `loadData(true)`, incrementing offset by 50
4. Hide the button when `hasMore` is false (i.e., last fetch returned fewer than 50 rows)
5. On "Refresh", reset offset to 0 and replace all data

