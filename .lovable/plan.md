

## Add delete & re-import for manual (Intercom) conversations

### Problem
A previously imported Intercom ticket had incomplete data (messages didn't import). Now re-importing fails with "Already imported" because the duplicate check finds the existing row. There's no way to delete it and try again.

### Solution
Add a **Delete conversation** button on the conversation detail page for manual-source conversations. Deleting removes the `manual_conversations` row and its `manual_messages`, allowing re-import.

### Implementation

**`supabase/functions/import-intercom-ticket/index.ts`**
1. Add a `force` parameter. When `force: true` is passed, delete the existing `manual_conversations` row (and cascade messages) before re-importing, instead of returning 409.

**`src/components/ImportTab.tsx`**
2. When the "Already imported" toast appears for Intercom, add a **Re-import** action button that re-calls the function with `force: true`.

**`src/pages/ConversationDetail.tsx`**
3. Add a **Delete conversation** button in the sidebar for `source === "manual"` conversations. On click, show a confirmation dialog, then delete from `manual_messages` (by `conversation_id`) and `manual_conversations` (by `id`), and navigate back to `/conversations`.

**`supabase/functions/import-intercom-ticket/index.ts`** (detail)
- Accept optional `force: boolean` in request body
- When `force` is true and a duplicate exists in `manual_conversations`, delete the existing row and its messages before proceeding with the import
- If the duplicate is in `conversation_mappings` or `gmail_conversations`, still return 409 (don't delete those)

### Files to edit
- `supabase/functions/import-intercom-ticket/index.ts`
- `src/components/ImportTab.tsx`
- `src/pages/ConversationDetail.tsx`

