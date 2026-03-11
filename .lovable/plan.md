

## Plan: Fetch parent message when bot is tagged in a thread reply

### Problem
When someone posts a question in Slack without tagging the bot, then another person tags the bot in a reply to that thread, the bot currently captures the reply text (e.g., "@bot") as the message — not the original question.

### Solution
In `supabase/functions/slack-events/index.ts`, when an `app_mention` event has a `thread_ts` (meaning it's a reply, not a top-level message), fetch the parent message using Slack's `conversations.history` API and use that as the `original_message_text`.

### Changes

**`supabase/functions/slack-events/index.ts`**:

- After determining `threadTs` and detecting that `event.thread_ts` exists (the mention is a thread reply, not the original message):
  - Call `conversations.history` with `channel`, `latest=threadTs`, `limit=1`, `inclusive=true` to fetch the parent message
  - Use the parent message's text as `messageText` instead of the mention text
  - Also use the parent message's `user` as the `slackUserId` (the person who asked the question, not the person who tagged the bot)
- If the mention is a top-level message (no `thread_ts`), keep current behavior

