

## Improve conversation search to include message content

### Problem
The current search only matches against metadata columns (subject, sender name, status, product area). It never searches the actual message content — Slack thread replies aren't searched, Gmail full bodies aren't searched, and `manual_messages` text isn't searched. This makes it nearly impossible to find conversations by what was actually discussed.

### Solution
Create a backend function that performs a full-text search across all conversation sources, including message content. Use a two-pass approach: first search metadata (fast, current behavior), then also search message content tables to find conversations by what was said in them.

### Changes

**New edge function: `supabase/functions/search-conversations/index.ts`**
- Accepts `{ query: string, source?: string }` 
- Uses service role to query across tables
- Searches `manual_messages.message_text` and joins back to `manual_conversations` to return matching conversation IDs
- For Slack: searches `original_message_text` on `conversation_mappings` (thread message content isn't stored in DB — only the first message is)
- For Gmail: searches `subject` and `snippet` on `gmail_conversations`
- For manual: searches both `manual_conversations.subject` + `manual_messages.message_text`
- Returns deduplicated conversation IDs grouped by source
- Uses `ilike` for simple substring matching (no AI needed — just searching more tables)

**`src/pages/Conversations.tsx`**
- Update the search effect to also query `manual_messages` for matching message text
- For the manual source: run an additional query on `manual_messages` where `message_text ilike query`, collect the `conversation_id`s, then fetch those conversations and merge with the existing metadata search results
- This can be done client-side with two Supabase queries — no edge function needed:
  1. Current metadata search (keep as-is)
  2. Additional `manual_messages` search: `supabase.from("manual_messages").select("conversation_id").ilike("message_text", ilike)` → get unique conversation IDs → fetch those conversations → merge into results

Actually, the simplest effective approach: add a parallel query to `manual_messages` in the existing search effect, merge the resulting conversation IDs into the manual results. This avoids a new edge function entirely.

**`src/pages/FlowDiagram.tsx`**
- Note that search now includes message content for manual conversations

### Technical details

In the existing `doSearch` function, add after the three parallel queries:

```typescript
// Also search manual message content
const msgRes = await supabase
  .from("manual_messages")
  .select("conversation_id")
  .ilike("message_text", ilike)
  .limit(200);

const extraIds = (msgRes.data ?? [])
  .map(r => r.conversation_id)
  .filter(id => !manualRes.data?.some(m => m.id === id));

if (extraIds.length > 0) {
  const { data: extraConvos } = await supabase
    .from("manual_conversations")
    .select("*")
    .in("id", extraIds);
  // merge into manual results
}
```

This is lightweight, requires no new edge function, and immediately makes manual conversation search much more useful since it searches the actual thread content.

### Files to edit
- `src/pages/Conversations.tsx` — add manual_messages content search
- `src/pages/FlowDiagram.tsx` — note improved search

