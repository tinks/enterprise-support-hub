

## Fix Gmail resolve persistence and add error handling

### Problem
Conversation `1075c6ca` was resolved in the UI but the database still shows `status: 'open'`. The resolve button does an optimistic UI update followed by a fire-and-forget Supabase update with no error handling. If the DB write fails, the user sees "resolved" until the next refresh, then it reverts.

Additionally, this conversation is marked `is_test: true`, so it only appears in Stats under the "Test" environment filter — not in the default "Live" view.

### Changes

**File: `src/pages/Conversations.tsx`**

1. **Remove `as any` cast** on both the resolve update and the `toggleTest` update for Gmail — the types are compatible, the cast is unnecessary and hides errors.

2. **Add error handling** to the resolve button's `onClick`: after the `await supabase.from(...).update(...)`, check for an error and if present, revert the optimistic update and show a toast.

3. **Same for `toggleTest`** for Gmail rows — add error handling and revert on failure.

**Database migration** — fix the stuck conversation:
```sql
UPDATE gmail_conversations
SET status = 'resolved', resolved_at = now()
WHERE id = '1075c6ca-6295-4f66-b2db-51cdc20a738e';
```

**File: `src/pages/FlowDiagram.tsx`** — document the error handling addition for Gmail resolve actions.

### Note on Stats visibility
This conversation is `is_test: true`, so it will only count toward Gmail resolved in the "Test" environment view on Stats. If you want it in the live view, toggle the test switch off on the Conversations page.

### Files to edit
- `src/pages/Conversations.tsx` — remove `as any`, add error handling with toast + revert
- Database migration — fix the stuck row
- `src/pages/FlowDiagram.tsx` — document the change

