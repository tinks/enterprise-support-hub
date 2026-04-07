

## Fix: Re-add note filtering + track live replies for manual Intercom conversations

### Problem 1: Internal notes included unnecessarily
The `"note"` part type was removed from `SKIP_PART_TYPES` as a debugging step, but the actual blocker was `"assignment"`. Internal notes should be filtered again to avoid leaking private team notes into the conversation view.

### Problem 2: Live replies not tracked
When someone replies in an Intercom conversation that was imported into `manual_conversations`, the webhook doesn't append the new message. The reply webhook handler only looks up `conversation_mappings` (Slack-originated conversations) — it never checks `manual_conversations`. So subsequent replies after import are lost.

### Solution

**`supabase/functions/import-intercom-ticket/index.ts`**
- Re-add `"note"` to `SKIP_PART_TYPES`: `["note", "open", "close", "away_mode_assignment"]`

**`supabase/functions/intercom-webhook/index.ts`**

1. Re-add `"note"` to `SKIP_PART_TYPES` in the auto-import block (line 260)
2. For reply topics (`conversation.admin.replied`, etc.): after the existing `conversation_mappings` lookup fails, add a fallback that checks `manual_conversations` for the `intercom_conversation_id`
3. If a matching `manual_conversations` row is found, extract the reply text from the webhook payload (`body.data.item.conversation_parts.conversation_parts[0].body`), strip HTML, and insert a new row into `manual_messages` with the correct `conversation_id`, `sender_name`, `role`, and `created_at`
4. Return early after inserting — no Slack forwarding needed for manual conversations

```text
Current flow (reply topics):
  webhook → lookup conversation_mappings → not found → ignore

New flow:
  webhook → lookup conversation_mappings → found → forward to Slack (existing)
  webhook → lookup conversation_mappings → not found
         → lookup manual_conversations by intercom_conversation_id
         → found → insert new message into manual_messages
         → not found → ignore
```

**`src/pages/FlowDiagram.tsx`**
- Update flow to reflect live reply tracking for manual Intercom conversations

### Files to edit
- `supabase/functions/import-intercom-ticket/index.ts`
- `supabase/functions/intercom-webhook/index.ts`
- `src/pages/FlowDiagram.tsx`

