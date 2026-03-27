

## Show full conversation thread on detail page

### Problem
The conversation detail page only shows the `original_message_text` from the database. The actual back-and-forth (Sam's replies, user follow-ups, employee replies) lives in Slack threads and isn't displayed.

### Approach
Create a new edge function that fetches the full Slack thread for a conversation, then display all messages in the detail page as a chat-style timeline.

### Steps

**1. New edge function: `supabase/functions/fetch-thread-messages/index.ts`**
- Accepts `{ channelId, threadTs }` in the request body
- Calls Slack `conversations.replies` API (already used elsewhere in the codebase)
- For each message, resolves the sender via `users.info` (can batch-cache)
- Returns an array of `{ text, user_name, user_avatar, ts, is_bot }` sorted chronologically
- Uses existing `SLACK_BOT_TOKEN` secret

**2. Update `src/pages/ConversationDetail.tsx`**
- After loading the conversation mapping, call the new edge function with `slack_channel_id` and `slack_thread_ts`
- Render messages in a chat timeline below the "Original message" card:
  - Each message shows: avatar, sender name, timestamp, message text
  - Bot messages (from Ask Lovable / Sam) styled differently (e.g. left-aligned with bot icon)
  - User/employee messages styled on the other side or with different background
  - Slack markup cleaned for display
- Add a "Refresh" button to re-fetch the thread

**3. Update flow diagram** — No logic change, just a new utility function; minimal update to note the thread viewer exists.

### Technical notes
- Slack `conversations.replies` returns up to 100 messages per call (with cursor pagination for longer threads)
- The edge function handles pagination to return all messages
- No database schema changes needed — messages are fetched live from Slack
- Bot messages identified by matching `user` field against `settings.slack_bot_user_id`

### Files changed
- `supabase/functions/fetch-thread-messages/index.ts` (new)
- `src/pages/ConversationDetail.tsx` (add thread timeline UI)

