

## Fix: Ticket admin replies not relayed to Slack after Sam auto-escalation

### Root Cause

When Sam auto-escalates, the `slack-interactions` function converts the conversation into an Intercom **ticket** (Type ID 1). After that, subsequent admin replies arrive as `ticket.admin.replied` webhooks instead of `conversation.admin.replied`.

The payload structure for `ticket.admin.replied` is different:

```text
conversation.admin.replied → body.data.item.id = "215473561113063"  (conversation ID)
ticket.admin.replied       → body.data.item.id = undefined
                              body.data.item.ticket.id = "215473561113063"
```

On **line 158**, the conversation ID extraction is:
```typescript
const conversationId = body.data?.item?.id || body.data?.item?.ticket_id || body.data?.item?.conversation_id;
```

This misses `body.data?.item?.ticket?.id`, so `conversationId` is `undefined`, and the webhook returns a 400 error ("No conversation ID found"). Confirmed in the logs:
```
Intercom webhook topic: ticket.admin.replied, conversation_id: undefined
No conversation ID found in webhook payload
```

### Fix

**File: `supabase/functions/intercom-webhook/index.ts`** — Line 158

Add `body.data?.item?.ticket?.id` to the extraction chain:

```typescript
const conversationId = body.data?.item?.id
  || body.data?.item?.ticket?.id
  || body.data?.item?.ticket_id
  || body.data?.item?.conversation_id;
```

Also update the debug log on line 133 to use the same extraction so it's visible:

```typescript
const itemId = body.data?.item?.id || body.data?.item?.ticket?.id;
console.log(`Intercom webhook topic: ${topic}, conversation_id: ${itemId}`);
```

Redeploy `intercom-webhook` after editing.

