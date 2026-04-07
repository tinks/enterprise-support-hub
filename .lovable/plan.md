

## Auto-resolve manual and Gmail conversations on Intercom close

### Problem
When an Intercom conversation is closed/resolved, the webhook handler only updates `conversation_mappings` (Slack-originated conversations). Conversations tracked in `manual_conversations` or `gmail_conversations` are ignored because:
1. The close handler (line 476) requires a `mapping` from `conversation_mappings`
2. The fallback for `manual_conversations` (line 406-468) only handles reply topics, not close topics

### Solution

**`supabase/functions/intercom-webhook/index.ts`**

Extend the `!mapping` fallback block (around line 406) to also handle `CLOSED_TOPICS`:
- When `topic` is in `CLOSED_TOPICS` and no `conversation_mappings` match is found, search `manual_conversations` and `gmail_conversations` by `intercom_conversation_id`
- If found, update `status` to `"resolved"` and set `resolved_at` to now
- Log the resolution and return

```text
Current flow (no mapping found):
  REPLY_TOPICS → check manual_conversations → append message
  CLOSED_TOPICS → "No mapping found" → ignore

New flow (no mapping found):
  REPLY_TOPICS → check manual_conversations → append message
  CLOSED_TOPICS → check manual_conversations + gmail_conversations
               → found → update status to "resolved", set resolved_at
               → not found → "No mapping found"
```

**`src/pages/FlowDiagram.tsx`**
- Update flow to note that Intercom close events resolve conversations across all three tables

### Files to edit
- `supabase/functions/intercom-webhook/index.ts`
- `src/pages/FlowDiagram.tsx`

