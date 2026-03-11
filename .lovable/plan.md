

## Plan: Two Changes to Intercom Webhook

### 1. Show thumbs-up button on ALL admin replies (not just bot)

Currently, the intercom-webhook only shows feedback buttons when `mapping.status !== "escalated"`. This means after escalation to a human agent, the Slack user never gets the resolve button. 

**Fix**: Always show the 👍 button on replies, regardless of status. When escalated, only show the 👍 (no need for 👎 since they already escalated).

### 2. Handle conversation closed/resolved in Intercom

Subscribe to the `conversation.admin.closed` topic in the intercom-webhook. When received, send a Slack message from the Lovable Support Bot saying the issue has been marked as resolved, and update the mapping status to `resolved`.

### File changes

**`supabase/functions/intercom-webhook/index.ts`**:

- Expand the topic filter to also accept `conversation.admin.closed`
- When topic is `conversation.admin.closed`:
  - Look up the mapping
  - If found and not already resolved, post a message to the Slack thread: "This issue has been marked as resolved. If you need further help, reply in this thread to start the conversation again."
  - Update mapping status to `resolved`
  - Return early (no reply text processing needed)
- For reply topics: always show the 👍 button. Show 👎 only when status is not `escalated`.

### Intercom webhook subscription

The user will need to add `conversation.admin.closed` to their Intercom webhook subscriptions. I'll note this in the implementation.

