

## Sync status, owner, product area, and classification across Gmail thread groups

### What changes
When a user updates the status, owner, product area, or classification on any row within a Gmail thread group, all sibling rows in that same thread (sharing the same `gmail_thread_id` / normalized subject key) will be updated simultaneously — both in the UI state and in the database.

### How it works

**`src/pages/Conversations.tsx`**

1. Create a helper function `getGmailThreadSiblingIds(id: string): string[]` that:
   - Looks through `gmailRows` to find the row with the given `id`
   - Gets its `gmail_thread_id` (or falls back to normalized subject)
   - Returns all IDs in `gmailRows` that share the same thread key

2. Update `updateStatus` — when `source === "gmail"`:
   - Get all sibling IDs via the helper
   - Update all siblings in local state (not just the clicked row)
   - Batch-update all siblings in the database using `.in("id", siblingIds)` instead of `.eq("id", id)`

3. Apply the same sibling-update pattern to:
   - `updateProductArea` (gmail branch)
   - `updateOwner` (gmail branch)
   - `updateClassification` (gmail branch)

4. No changes needed for Slack or Manual sources (they don't have thread grouping)

### Files to edit
- `src/pages/Conversations.tsx`

