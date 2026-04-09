

## Inherit metadata for new Gmail messages in existing threads

### Problem
When `poll-gmail` inserts a new message belonging to an existing Gmail thread, it doesn't carry over `owner`, `classification`, or `product_area` from sibling messages already in the database.

### Solution
In `supabase/functions/poll-gmail/index.ts`, after building the insert payload but before inserting, look up existing messages in the same thread and copy their metadata.

### Changes

**`supabase/functions/poll-gmail/index.ts`** — After extracting `msg.threadId`, query `gmail_conversations` for an existing sibling row with that `gmail_thread_id`. If found, copy `owner`, `classification`, `product_area`, `is_bug`, `is_feature_request`, `status`, and `intercom_conversation_id` into the insert payload.

```typescript
// After line 231 (gmail_thread_id extraction), before insert:
let inherited: Record<string, any> = {};
if (msg.threadId) {
  const { data: sibling } = await supabase
    .from("gmail_conversations")
    .select("owner, classification, product_area, is_bug, is_feature_request, intercom_conversation_id")
    .eq("gmail_thread_id", msg.threadId)
    .not("owner", "is", null)
    .order("received_at", { ascending: false })
    .limit(1);
  if (sibling?.length) {
    inherited = {
      owner: sibling[0].owner,
      classification: sibling[0].classification,
      product_area: sibling[0].product_area,
      is_bug: sibling[0].is_bug,
      is_feature_request: sibling[0].is_feature_request,
      intercom_conversation_id: sibling[0].intercom_conversation_id,
    };
  }
}
// Then spread into insert: { ...inherited, gmail_message_id: msgId, ... }
```

**`src/pages/FlowDiagram.tsx`** — Document that new Gmail messages inherit metadata from existing thread siblings.

### Files to edit
- `supabase/functions/poll-gmail/index.ts` — add sibling lookup and metadata inheritance
- `src/pages/FlowDiagram.tsx` — update flow notes

