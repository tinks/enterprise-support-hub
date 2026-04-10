

## Capture customer replies from Intercom webhooks

### Problem
When a customer (like talita.linhares@beyondcompany.com) posts a comment on Intercom conversation 215473735932694, the webhook fires with topic `conversation.user.replied`. However, the `intercom-webhook` function only listens for **admin** reply topics (`conversation.admin.replied`, `conversation.admin.single.reply`, `ticket.admin.replied`). Customer replies are silently ignored at the topic filter on line 151.

### Solution
Add user reply topics to the `REPLY_TOPICS` array so customer messages are also captured and appended to `manual_messages`.

### Changes

**`supabase/functions/intercom-webhook/index.ts`** (line 148):
```typescript
// Before
const REPLY_TOPICS = ["conversation.admin.replied", "conversation.admin.single.reply", "ticket.admin.replied"];

// After
const REPLY_TOPICS = [
  "conversation.admin.replied",
  "conversation.admin.single.reply",
  "ticket.admin.replied",
  "conversation.user.replied",
  "conversation.user.created",
];
```

The existing reply-handling code at lines 461-508 already correctly maps `author.type === "user"` to `role: "user"`, so no other changes are needed for the manual conversation path.

For the `conversation_mappings` (Slack) path further down, user replies should also be forwarded. I'll verify that path handles user-authored parts correctly.

**`src/pages/FlowDiagram.tsx`** — Document that customer replies are now captured via `conversation.user.replied` and `conversation.user.created` topics.

### Files to edit
- `supabase/functions/intercom-webhook/index.ts` — expand `REPLY_TOPICS`
- `src/pages/FlowDiagram.tsx` — update flow documentation

