

## Temporary page: review and re-import old bot-tracked Slack conversations

### Context
25 conversations in `conversation_mappings` from channel `C0AJP396C85` have `is_test = false`. These were created by the old bot method — they have message text but 19/25 lack an owner, and their `created_at` is set to import time rather than the actual thread timestamp.

### Solution

**New page: `/test-review`** → `src/pages/TestChannelReview.tsx`

A temporary review page that:
- Loads all `conversation_mappings` where `is_test = false` and `slack_channel_id = 'C0AJP396C85'` (or configurable)
- Shows a table: message preview, status, owner, `created_at` vs actual thread time (derived from `slack_thread_ts`), time drift indicator
- Allows selecting rows for re-import
- "Re-import selected" button calls the updated `import-slack-thread` function with a `force` flag
- After re-import, the row's `created_at` is corrected to match the thread timestamp

**Edge function update: `import-slack-thread`**
- Add `force: true` flag — when set, updates existing row instead of returning 409 duplicate error
- On insert or force-update, set `created_at` to `to_timestamp(slack_thread_ts)` so the conversation is dated to when the user actually sent the first message
- Update `original_message_text` with freshly fetched parent message text

**Route + flow updates**
- Add `/test-review` route in `src/App.tsx`
- Update `src/pages/FlowDiagram.tsx` to note re-import path

### Files to create/edit
- `src/pages/TestChannelReview.tsx` (new)
- `supabase/functions/import-slack-thread/index.ts` (add `force` flag + set `created_at` from thread timestamp)
- `src/App.tsx` (add route)
- `src/pages/FlowDiagram.tsx` (update)

