

## Add duplicate cleanup to test review page

### Problem
After relinking a conversation from the test channel, the old manually-logged duplicate (in `manual_conversations`) still exists. You need a way to find and remove these duplicates from the /test-review page.

### Immediate fix
Delete the duplicate manual conversation `f1324624-4059-4834-a1c8-473f804e6d29` from `manual_conversations` (and its messages from `manual_messages`) via a migration.

### Feature: "Find duplicates" button on /test-review

**`src/pages/TestChannelReview.tsx`**

Add a "Find duplicates" section below the table:
- When clicked, for each row in the test channel list, search `manual_conversations` for entries with similar subject text (fuzzy match using first 40 chars of `original_message_text`)
- Display matches in a dialog/card showing: the manual conversation's subject, contact name, source, created_at, and a "Delete duplicate" button
- "Delete duplicate" calls `supabase.from("manual_conversations").delete().eq("id", ...)` and also deletes associated `manual_messages` — both tables allow public delete via RLS
- After deletion, show a toast and refresh

**Per-row approach**: Add a small "🔍 Dupes" button per row that searches for manual conversations matching that row's message text, so you can check and clean one at a time.

### Database migration
Delete the known duplicate:
```sql
DELETE FROM manual_messages WHERE conversation_id = 'f1324624-4059-4834-a1c8-473f804e6d29';
DELETE FROM manual_conversations WHERE id = 'f1324624-4059-4834-a1c8-473f804e6d29';
```

### Files to edit
- `src/pages/TestChannelReview.tsx` — add duplicate search + delete per row
- `src/pages/FlowDiagram.tsx` — note duplicate cleanup capability
- Database migration — remove the known duplicate

