

## Fix unique constraint violation on relink

### Problem
When relinking a conversation to a new Slack thread URL, the update sets `slack_channel_id` + `slack_thread_ts` to the new values. But if another row in `conversation_mappings` already has that exact channel+thread combo (from the unique index `idx_conversation_mappings_slack`), the update fails with a duplicate key error.

In this case, row `0c7a2630` is being relinked to thread `C098JSW5XBJ/1774918999.819219`, but another row already exists for that thread.

### Solution

**`supabase/functions/import-slack-thread/index.ts`**

When `force: true` + `existingId` is set and the target thread already exists as a different row:
1. Before the update, query for any existing row matching the new `channelId` + `threadTs` that is NOT the `targetId`
2. If found, delete that conflicting row first (it's a duplicate that will be replaced by the relinked record)
3. Then proceed with the update as before

```typescript
// Before the update block (~line 219):
if (targetId && force) {
  // Remove any conflicting row that already has this channel+thread
  const { data: conflicting } = await supabase
    .from("conversation_mappings")
    .select("id")
    .eq("slack_channel_id", channelId)
    .eq("slack_thread_ts", threadTs)
    .neq("id", targetId)
    .limit(1);

  if (conflicting && conflicting.length > 0) {
    await supabase
      .from("conversation_mappings")
      .delete()
      .eq("id", conflicting[0].id);
  }

  // Then update...
}
```

Note: the delete uses the service role key (already in use), bypassing the RLS deny-delete policy on the public role.

**`src/pages/FlowDiagram.tsx`**
- Note that relink auto-removes conflicting duplicate rows

### Files to edit
- `supabase/functions/import-slack-thread/index.ts`
- `src/pages/FlowDiagram.tsx`

