

## Relink conversation to a new Slack thread via re-import

### Problem
The current re-import flow only updates `original_message_text` and `created_at` on the existing row. It doesn't update `slack_channel_id`, `slack_thread_ts`, or `slack_user_id` — so the conversation stays linked to the old (wrong) thread. The user wants: click re-import → paste the correct Slack URL → old record is fully replaced with data from the new thread.

### UX flow
1. On `/test-review`, user clicks a "Re-import" button on a row
2. A dialog/popover opens asking for the correct Slack thread URL
3. On confirm, the edge function fetches the new thread's data and overwrites all fields on the existing row
4. The row updates in place with the correct channel, thread, user, message, and `created_at`

### Changes

**`supabase/functions/import-slack-thread/index.ts`**
- Accept optional `existingId` in request body
- When `force: true` + `existingId` is provided, skip the duplicate lookup and update the specified row with ALL fields: `slack_channel_id`, `slack_thread_ts`, `slack_user_id`, `original_message_text`, `created_at`
- Current update (line 216-221) only sets `original_message_text` and `created_at` — expand to include `slack_channel_id`, `slack_thread_ts`, `slack_user_id`

**`src/pages/TestChannelReview.tsx`**
- Replace the bulk select + custom URL popover approach with a simpler per-row "Re-import" button
- Clicking it opens a dialog with a URL input field
- On confirm, calls the edge function with `{ url, force: true, existingId: row.id }`
- On success, refresh the table
- Keep the existing bulk "Select drifted → Re-import selected" flow for rows that just need timestamp correction (no URL change)
- When bulk re-importing with a custom URL set, pass `existingId: row.id`

**`src/pages/FlowDiagram.tsx`**
- Note that force re-import with `existingId` fully relinks a conversation to a different Slack thread

### Files to edit
- `supabase/functions/import-slack-thread/index.ts`
- `src/pages/TestChannelReview.tsx`
- `src/pages/FlowDiagram.tsx`

