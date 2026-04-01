

## Make search work across all data, not just loaded rows

### Problem
Search on the conversations page only filters the rows already loaded in memory (50 per page). If a conversation isn't in the current paginated set, searching by ID or any field won't find it.

### Solution
When a search query is active, bypass pagination and query all three tables server-side with text filters, then merge results client-side.

### Changes

**`src/pages/Conversations.tsx`**

1. Add a debounced search effect: when `searchQuery` changes (and is non-empty), fire separate queries against `conversation_mappings`, `gmail_conversations`, and `manual_conversations` using Supabase `.or()` / `.ilike()` filters on relevant text columns (id, original_message_text, status, product_area, slack_user_id, slack_channel_id for slack; from_email, from_name, subject, snippet for gmail; contact_name, subject, source for manual)
2. Store search results in a separate state (e.g. `searchResults`) distinct from the paginated `mappings`/`gmailRows`/`manualRows`
3. In the `unified` useMemo, when `searchQuery` is active, use `searchResults` instead of the paginated data — skip the client-side search filter since results are already filtered server-side
4. When search is cleared, revert to showing the normal paginated data
5. Add a small debounce (300ms) to avoid hammering the database on every keystroke
6. For UUID-style queries, also do an exact `.eq("id", query)` match to ensure ID searches always work

**`src/pages/FlowDiagram.tsx`** — Document that conversation search now queries the database server-side

### Files to edit
- `src/pages/Conversations.tsx` — server-side search logic
- `src/pages/FlowDiagram.tsx` — document change

