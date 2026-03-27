

## Route all Slack conversations to the enterprise inbox from the start

### What's changing

Currently, new conversations are assigned only to Sam (AI agent). The enterprise team inbox only sees them after escalation. You want every conversation to appear in the enterprise inbox immediately — while Sam still handles it.

### How it works in Intercom

In Intercom, a conversation can be assigned to a **team inbox** and simultaneously to an **individual admin** within that team. The approach: after assigning to Sam, make a second assignment call to move the conversation into the enterprise team inbox (keeping Sam as the handler).

### Changes

**1. `supabase/functions/slack-interactions/index.ts` — `createIntercomTicket()` (after line ~336)**

After the existing Sam assignment block, add a second assignment call to the enterprise team inbox:

```typescript
// Also move to enterprise inbox so it's visible to the team
const inboxId = isTestConversation && cachedSettings.test_intercom_inbox_id
  ? cachedSettings.test_intercom_inbox_id
  : cachedSettings.intercom_inbox_id;
if (inboxId) {
  await fetch(`https://api.intercom.io/conversations/${conversationId}/parts`, {
    method: "POST",
    headers: intercomHeaders,
    body: JSON.stringify({
      message_type: "assignment",
      type: "team",
      assignee_id: inboxId,
      admin_id: cachedSettings.intercom_assignee_id,
      body: "",
    }),
  });
}
```

Note: the `is_test` check needs to be moved before this block (currently it's after line 338). We'll reorder so the `isTestConversation` variable is available.

**2. `supabase/functions/context-reminder/index.ts` — auto-proceed path (~line 206)**

Same pattern: after assigning to Sam, add the team inbox assignment call.

**3. No changes to escalation logic**

The existing escalation code (👎 button, auto-escalation) already reassigns to the enterprise inbox — but since the conversation is already there, these become no-ops for inbox routing. The escalation still handles ticket conversion (Type ID 1) and reaction swaps, so no code removal needed.

### Consideration

After this change, the enterprise inbox will show **all** conversations (including ones Sam resolves on its own). This increases inbox volume but gives full visibility. If this becomes noisy, we could later add a filter or tag to distinguish AI-handled vs escalated conversations.

### Files changed
- `supabase/functions/slack-interactions/index.ts` — add inbox assignment after Sam assignment
- `supabase/functions/context-reminder/index.ts` — same addition for auto-proceed path
- Flow diagram update if needed (per project rules)

