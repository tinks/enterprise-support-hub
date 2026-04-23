

## Why "no conversations found" despite the row existing

Ticket `215474005499607` is a real `manual_conversations` row (subject "Help - Multi-tenant architecture…", owner Kristina, no product area, no classification). The `search_conversations` RPC returns it correctly — verified directly against the DB.

The row gets dropped client-side in `src/pages/Conversations.tsx` (the `unified` `useMemo`, lines 923–944) by one of these three filters that **still apply during search**:
- `ownerFilter` — anything except "all" or "Kristina" filters this row out
- `productAreaFilter` — any specific area or "unassigned-on-the-other-rows" combo filters it out
- `classificationFilter` — same story

The status filter is already bypassed during search (line 947 checks `!searchResults`), but the owner/product-area/classification filters are not. So if the inbox sidebar has any of those set, a search by ID silently returns nothing even when the RPC found the row.

## Fix

In `src/pages/Conversations.tsx`, wrap the three filter blocks (owner / product area / classification, lines 923–944) in `if (!searchResults)` so they only apply when browsing, not when explicitly searching. This matches the existing pattern already used for the status filter on line 947.

Result: pasting any ID, email, or text into search returns every match the RPC found, regardless of sidebar filter state.

### Optional polish (recommend including)

When `searchResults` is active and the result count is non-zero but the visible filtered count would have been zero, show a one-line hint above the table: "Showing N matches. Sidebar filters were ignored for search." So users aren't confused when search results don't match their current filter chips.

### Out of scope

- Changing the source filter behavior during search (it's intentional — narrowing a search to one source is reasonable).
- Any RPC changes — server-side search is working correctly.
- Detail-page deep-link from a bare ID paste.

