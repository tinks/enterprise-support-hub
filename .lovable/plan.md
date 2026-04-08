

## Fix duplicate conversation creation from Intercom webhooks

### Problem
When a conversation is assigned in Intercom, multiple webhook events fire nearly simultaneously (e.g. `conversation.admin.assigned` and `ticket.team.assigned`). Both hit the assignment handler, both pass the duplicate check (neither has inserted yet), and both create a new `manual_conversations` row. The screenshot shows two pairs of exact duplicates with identical `intercom_conversation_id` values.

### Root causes
1. **Race condition**: No atomic deduplication — the check-then-insert is not atomic, so concurrent webhooks both pass the "already tracked?" check
2. **Multiple events per action**: Intercom sends both conversation-level and ticket-level assignment events for the same action

### Solution

**Database migration — add unique constraint**
- Add a unique index on `manual_conversations.intercom_conversation_id` (where not null) to prevent duplicates at the database level
- This is the only reliable fix for race conditions — application-level checks can't prevent them

**`supabase/functions/intercom-webhook/index.ts`**
- Change the insert to use upsert with `onConflict: 'intercom_conversation_id'` so the second webhook gracefully no-ops instead of failing
- Also fix the ID extraction in the assignment handler (line 162) to match the reply handler logic: prioritize `item.ticket.id` for ticket topics, since `item.id` on ticket events can be a part ID

**Database cleanup**
- Delete the 2 duplicate rows (keep one of each pair)

**`src/pages/FlowDiagram.tsx`**
- Note deduplication constraint on Intercom imports

### Technical details

Migration:
```sql
-- Remove duplicates first (keep the earliest inserted)
DELETE FROM manual_messages WHERE conversation_id IN (
  SELECT id FROM manual_conversations mc1
  WHERE EXISTS (
    SELECT 1 FROM manual_conversations mc2
    WHERE mc2.intercom_conversation_id = mc1.intercom_conversation_id
      AND mc2.id < mc1.id
  )
);
DELETE FROM manual_conversations mc1
WHERE EXISTS (
  SELECT 1 FROM manual_conversations mc2
  WHERE mc2.intercom_conversation_id = mc1.intercom_conversation_id
    AND mc2.id < mc1.id
);

-- Add unique constraint
CREATE UNIQUE INDEX idx_manual_conversations_intercom_id
  ON manual_conversations (intercom_conversation_id)
  WHERE intercom_conversation_id IS NOT NULL;
```

Webhook insert change:
```typescript
const { data: inserted, error: insertErr } = await supabase
  .from("manual_conversations")
  .upsert(insertPayload, { onConflict: "intercom_conversation_id" })
  .select("id")
  .single();
```

### Files to edit
- Database migration — unique index + cleanup duplicates
- `supabase/functions/intercom-webhook/index.ts` — upsert + fix ID extraction for ticket topics
- `src/pages/FlowDiagram.tsx` — note deduplication

