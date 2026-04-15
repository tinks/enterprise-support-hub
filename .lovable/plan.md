

## Fix: Create a database function for robust multi-table search

### Problem
PostgREST does not support column type casting (`id::text`) inside `.or()` filter strings. The `id::text.ilike.%q%` syntax either returns a 400 error or silently returns no results. This is why partial UUID searches like `312d14c3` keep failing despite multiple attempts.

### Solution
Create a Postgres RPC function `search_conversations` that performs the search server-side with proper SQL casting, then call it from the frontend.

### Step 1: Database migration — create `search_conversations` function

```sql
CREATE OR REPLACE FUNCTION public.search_conversations(search_term text)
RETURNS TABLE (
  result_id uuid,
  result_source text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  ilike_term text := '%' || search_term || '%';
BEGIN
  -- Slack conversations
  RETURN QUERY
  SELECT id, 'slack'::text FROM conversation_mappings
  WHERE id::text ILIKE ilike_term
     OR original_message_text ILIKE ilike_term
     OR status ILIKE ilike_term
     OR product_area ILIKE ilike_term
     OR slack_user_id ILIKE ilike_term
     OR slack_channel_id ILIKE ilike_term
     OR intercom_conversation_id ILIKE ilike_term
     OR slack_user_name ILIKE ilike_term
     OR owner ILIKE ilike_term
     OR classification ILIKE ilike_term;

  -- Gmail conversations
  RETURN QUERY
  SELECT id, 'gmail'::text FROM gmail_conversations
  WHERE id::text ILIKE ilike_term
     OR from_email ILIKE ilike_term
     OR from_name ILIKE ilike_term
     OR subject ILIKE ilike_term
     OR snippet ILIKE ilike_term
     OR status ILIKE ilike_term
     OR product_area ILIKE ilike_term
     OR intercom_conversation_id ILIKE ilike_term
     OR owner ILIKE ilike_term
     OR classification ILIKE ilike_term;

  -- Manual conversations
  RETURN QUERY
  SELECT id, 'manual'::text FROM manual_conversations
  WHERE id::text ILIKE ilike_term
     OR contact_name ILIKE ilike_term
     OR subject ILIKE ilike_term
     OR source ILIKE ilike_term
     OR status ILIKE ilike_term
     OR product_area ILIKE ilike_term
     OR intercom_conversation_id ILIKE ilike_term
     OR owner ILIKE ilike_term
     OR classification ILIKE ilike_term
     OR link ILIKE ilike_term;

  -- Manual message content match
  RETURN QUERY
  SELECT DISTINCT mm.conversation_id, 'manual'::text
  FROM manual_messages mm
  WHERE mm.message_text ILIKE ilike_term;
END;
$$;
```

### Step 2: Update `src/pages/Conversations.tsx` — replace `doSearch`

Replace the current `doSearch` function (lines 750-820) with:

1. Call `supabase.rpc('search_conversations', { search_term: q })` to get matching IDs and sources
2. Group IDs by source (slack, gmail, manual)
3. Fetch full rows for each source using `.in('id', ids)` (which works perfectly on UUID columns)
4. Keep existing source filter logic — only fetch sources that match `sourceFilter`

This eliminates all `.or()` filter strings and the `id::text` casting problem entirely.

### Why this works
- SQL natively supports `id::text ILIKE '%312d14c3%'` — no PostgREST limitations
- Single RPC call replaces 4 parallel queries for the ID/text matching phase
- Full row fetches use simple `.in('id', [...])` which is reliable
- Searches all fields including partial UUIDs, owner names, classifications, message content

### Files to change
- **Database**: New migration with `search_conversations` function
- **`src/pages/Conversations.tsx`**: Rewrite `doSearch` to use the RPC + `.in()` pattern (~30 lines changed)

