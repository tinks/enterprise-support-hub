

## Fix: Track Intercom replies for Gmail-linked conversations

### Problem
When you reply in Intercom to a conversation linked to a `gmail_conversations` row, the webhook handler doesn't recognize it. The reply handler only checks `conversation_mappings` and `manual_conversations` — it never looks up `gmail_conversations`. This means:
- Status never updates (stays "open" instead of "awaiting_customer")
- No reply tracking or logging happens
- The webhook logs "No mapping found" and exits silently

### Root cause
Lines 532-592 of `intercom-webhook/index.ts` handle `REPLY_TOPICS` for non-Slack conversations. They search `manual_conversations` by `intercom_conversation_id` but skip `gmail_conversations` entirely. Gmail conversations are metadata-only rows (no `manual_messages`-style message table), so the handler was never built to track replies for them.

### Solution
Add a Gmail fallback in the reply handler: after the `manual_conversations` check fails, also check `gmail_conversations`. For Gmail rows, update the status based on who replied (`awaiting_customer` for admin, `awaiting_support` for user). No message insertion is needed since Gmail conversations don't store individual messages.

Also add the same fallback to the close handler (lines 595-637), which already handles Gmail but only if `manual_conversations` fails first — this part works correctly.

### Changes

**File: `supabase/functions/intercom-webhook/index.ts`** (~lines 532-593)
- After the `manual_conversations` reply handler block (line 592), add a new block that:
  1. Searches `gmail_conversations` by `intercom_conversation_id` for all candidate IDs
  2. If found, updates the status to `awaiting_customer` (admin reply) or `awaiting_support` (user reply) based on `latestPart.author.type`
  3. Logs the status update
  4. Returns success

**File: `src/pages/FlowDiagram.tsx`**
- Update the relevant webhook handler node to document that Gmail conversations now get status updates from Intercom replies

### Technical detail
```text
Current reply handler flow:
  1. Check conversation_mappings → not found
  2. Check manual_conversations → not found
  3. "No mapping found" → exit

Fixed flow:
  1. Check conversation_mappings → not found
  2. Check manual_conversations → not found
  3. [NEW] Check gmail_conversations → found → update status
  4. "No mapping found" → exit (only if all 3 miss)
```

### Files to edit
- `supabase/functions/intercom-webhook/index.ts` — add gmail_conversations reply tracking
- `src/pages/FlowDiagram.tsx` — update documentation

