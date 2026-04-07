

## Add "Log as manual" action to test review page

### Problem
The current duplicate finder requires manually searching and deleting — clunky. You want a single action per row: click a button, paste the thread text, and it gets saved as a manual conversation while the old bot-tracked `conversation_mappings` row is deleted.

### Solution

Add a "Log & replace" button per row on `/test-review` (similar to the existing Relink dialog):

1. **New dialog**: Click "Log & replace" on a row → opens a dialog with:
   - Channel name input (pre-filled with the channel name)
   - Date picker (pre-filled from thread timestamp)
   - Large textarea to paste the raw Slack thread
   - Owner dropdown (pre-filled from row's owner if set)
   - "Parse & save" button

2. **On submit**:
   - Parse the pasted thread using the same `parseThread()` logic from ManualLogTab
   - Create a `manual_conversations` entry with source `slack_thread`, the channel name, contact name from first message, subject from first ~60 chars
   - Create `manual_messages` for each parsed message
   - Copy over `owner`, `product_area`, `classification`, `is_bug`, `is_feature_request` from the original row
   - Set `created_at` to the selected date
   - Delete the original `conversation_mappings` row (via edge function since RLS denies public delete — use the existing `import-slack-thread` function's service role, or add a small new edge function)
   - Refresh the table

3. **Deleting the old row**: Since `conversation_mappings` has `Deny public delete` RLS, we need a small edge function or use the existing service-role pattern. Simplest: add a new edge function `delete-conversation-mapping` that accepts an ID and deletes it with service role.

### Technical details

**`src/pages/TestChannelReview.tsx`**
- Extract `parseThread` and `cleanBody` from ManualLogTab into a shared util (`src/lib/parseThread.ts`)
- Add "Log & replace" button per row (next to Relink)
- New dialog with textarea, channel input, date picker, owner select
- On save: insert into `manual_conversations` + `manual_messages`, then call edge function to delete the `conversation_mappings` row

**`src/lib/parseThread.ts`** (new)
- Move `parseThread`, `cleanBody`, `ADMIN_NAMES` from ManualLogTab

**`src/components/ManualLogTab.tsx`**
- Import `parseThread` from shared util instead of defining locally

**`supabase/functions/delete-conversation-mapping/index.ts`** (new)
- Accepts `{ id: string }`, deletes from `conversation_mappings` using service role
- Simple ~20 line function

**`src/pages/FlowDiagram.tsx`**
- Note the "Log & replace" capability

### Files to create/edit
- `src/lib/parseThread.ts` (new — shared parser)
- `supabase/functions/delete-conversation-mapping/index.ts` (new — service-role delete)
- `src/pages/TestChannelReview.tsx` (add Log & replace dialog)
- `src/components/ManualLogTab.tsx` (import from shared util)
- `src/pages/FlowDiagram.tsx` (update notes)

