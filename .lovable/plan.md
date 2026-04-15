

## Add delete button for bot messages in Slack threads

### Overview
Add a trash icon on bot messages in the conversation detail thread view. Clicking it will delete the message from Slack via the `chat.delete` API, then remove it from the local state.

### Changes

**1. New edge function: `supabase/functions/delete-slack-message/index.ts`**

A simple function that accepts `{ channelId, messageTs }` and calls Slack's `chat.delete` API using `SLACK_BOT_TOKEN`. The bot can only delete its own messages, which is exactly the use case here.

**2. `src/pages/ConversationDetail.tsx` — Add trash button on bot messages**

In the thread message rendering loop (around line 658-691), add a `Trash2` icon button that appears on hover for bot messages only (`msg.is_bot === true`). On click:
- Show a confirmation (or just proceed directly since it's a destructive action on a bot message)
- Call the `delete-slack-message` edge function with the channel ID and message timestamp
- On success, remove the message from `threadMessages` state and show a toast
- On failure, show an error toast

The trash icon will be small and subtle, appearing on the right side of the message header row (next to the timestamp).

### Files to change
- **New**: `supabase/functions/delete-slack-message/index.ts`
- **Edit**: `src/pages/ConversationDetail.tsx` — add delete handler + trash icon on bot messages

### Technical details
- The edge function uses `SLACK_BOT_TOKEN` and calls `https://slack.com/api/chat.delete`
- Bot tokens can only delete messages the bot posted, so this is safe
- No database changes needed
- No flow diagram update needed (this is a UI convenience, not a logic change)

