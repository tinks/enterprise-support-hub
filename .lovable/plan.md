

## Fix re-import UX and add message sync for linked conversations

### Problem
Re-importing an Intercom conversation that's already tracked in `gmail_conversations` or `conversation_mappings` shows a "Re-import" button that loops back to the same 409 error. The `force` flag only works for `manual_conversations`.

### Changes

**1. Edit `src/components/ImportTab.tsx`** — smarter "Already imported" toast
- When `existingSource` is `gmail` or `slack`, show a **"View"** action button that navigates to the existing conversation instead of a "Re-import" button
- Keep "Re-import" only when `existingSource` is `manual`

**2. Edit `src/components/ImportTab.tsx`** — add "Sync messages" option
- When `existingSource` is `gmail` or `slack`, add a second toast action **"Sync"** that calls `backfill-intercom-replies` for the specific `intercom_conversation_id` to pull latest messages without creating duplicates

**3. Edit `supabase/functions/import-intercom-ticket/index.ts`** — ensure consistent response
- Verify the 409 response always includes `existingSource` for all three table types (already mostly done, just confirm `manual` case includes it)

### Technical detail
- The "Sync" action invokes `supabase.functions.invoke("backfill-intercom-replies", { body: { intercom_conversation_id } })` — this function already handles fetching new parts and inserting only missing messages
- Navigation uses existing `navigateToConversation` pattern with correct `?source=` param

### Files
- **Edit**: `src/components/ImportTab.tsx`
- **Edit**: `supabase/functions/import-intercom-ticket/index.ts` (minor verification)

