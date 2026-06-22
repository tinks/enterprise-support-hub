
## Goal
Surface each Intercom conversation's **Tags** in the Inbox V2 sandbox — stored in `inbox_v2_tickets`, displayed as a column, and filterable in `/inbox-v2`.

## Backend

1. **Migration** — add `tags text[]` (default `'{}'`) to `public.inbox_v2_tickets`. No new policies/grants needed.

2. **`supabase/functions/sync-inbox-v2/index.ts`**
   - Add helper `extractTags(icData)` returning `string[]` of trimmed tag names from `icData.tags?.tags?.[].name` (empty array if none).
   - Include `tags` in the upserted `row`. Overwrite on sync — drift is the signal (consistent with owner/product_area/classification in this sandbox).

3. **Backfill** — existing "Backfill (30d)" button calls `sync-inbox-v2` with `full: true`, so tags populate retroactively. No new function.

## Frontend (`src/pages/InboxV2.tsx`)

1. Extend `Row` type with `tags: string[] | null`; include `tags` in the `.select(...)` query.
2. Add `"tags"` to `ColKey`, `COL_ORDER` (after `classification`), `COL_LABELS` ("Tags"), `DEFAULT_WIDTHS` (~220). No sort handler.
3. Render cell: map tags to small `<Badge variant="secondary">` chips with wrap + truncation; empty → muted "—".
4. **Tag filter** (multi-select, matching existing pattern):
   - Compute distinct tag values from loaded rows (flatten + dedupe + sort), plus a "(no tags)" option for rows where the array is empty/null.
   - Add a `MultiFilterSelect` labelled "Tags" next to the existing Owner/Product Area/Classification/Status filters.
   - Filter logic: row passes if any selected tag is present in `row.tags`, or `(no tags)` is selected and `row.tags` is empty/null. Combined with other filters via AND (same as today).

## Docs
Update `.lovable/project-knowledge.md`, the Flow page note for Inbox V2, and `mem://features/inbox-v2-sandbox.md` to mention `tags` is now mirrored from Intercom and filterable in the UI.

## Out of scope
- Sorting by tags.
- Changes to live tables or live Inbox UI.
