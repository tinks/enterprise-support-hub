

## Fix manual conversation date mismatches

### Problem
27 conversations (20 `slack_thread`, 7 `intercom`) have `created_at` drifting 1+ hours from their earliest message. The root causes differ by source:

- **Paste mode (`slack_thread`)**: `created_at` is set to the thread date picker value (midnight CET → 22:00 or 23:00 UTC), but individual messages get timestamps from the parsed text (e.g. "1:47 PM" on the *next* day). The conversation isn't updated afterward.
- **Intercom imports**: Already covered in the previous plan — race condition with two-step insert/update.

### Fix plan

**Step 1 — Fix all 27 existing rows (SQL migration)**

```sql
UPDATE manual_conversations mc
SET created_at = sub.earliest
FROM (
  SELECT conversation_id, MIN(created_at) AS earliest
  FROM manual_messages GROUP BY conversation_id
) sub
WHERE mc.id = sub.conversation_id
  AND ABS(EXTRACT(EPOCH FROM mc.created_at - sub.earliest)) > 3600;
```

**Step 2 — Fix paste mode in `src/components/ManualLogTab.tsx`**

After inserting messages (~line 173), compute the earliest `created_at` from `messagesToInsert` and update the conversation row to match. This handles cases where the parsed message timestamps don't align with the date picker value.

```tsx
// After message insert succeeds:
const timestamps = messagesToInsert
  .filter(m => m.created_at)
  .map(m => new Date(m.created_at!).getTime());
if (timestamps.length) {
  const earliest = new Date(Math.min(...timestamps)).toISOString();
  await supabase
    .from("manual_conversations")
    .update({ created_at: earliest })
    .eq("id", convo.id);
}
```

**Step 3 — Fix Intercom import edge functions**

In each of these three functions, compute the earliest message timestamp *before* the conversation INSERT and include it as `created_at` in the insert payload. Remove the separate post-insert UPDATE.

- `supabase/functions/intercom-webhook/index.ts`
- `supabase/functions/import-intercom-ticket/index.ts`
- `supabase/functions/bulk-import-intercom/index.ts`

**Step 4 — Update flow diagram**

Document in `src/pages/FlowDiagram.tsx` that all import paths now derive `created_at` from the earliest message timestamp.

### Files to edit
- SQL migration (fix 27 rows)
- `src/components/ManualLogTab.tsx`
- `supabase/functions/intercom-webhook/index.ts`
- `supabase/functions/import-intercom-ticket/index.ts`
- `supabase/functions/bulk-import-intercom/index.ts`
- `src/pages/FlowDiagram.tsx`

