

## Fix Intercom import: missing admin messages and ordering

### Problem
1. **Missing human agent responses**: The Intercom API paginates conversation parts (default ~20 per page). The current function only fetches the first page, so admin replies beyond page 1 are lost.
2. **Message ordering**: Messages are inserted without explicit chronological sorting, which can produce odd ordering.

### Solution

**`supabase/functions/import-intercom-ticket/index.ts`**

1. **Paginate conversation parts**: After the initial conversation fetch, check if `conversation_parts.pages` indicates more pages. Loop through all pages using the Intercom pagination URL (`conversation_parts.pages.next`) until all parts are collected.

2. **Sort messages chronologically**: After collecting all messages (source + all parts), sort by `created_at` ascending before inserting into `manual_messages`.

3. **Keep existing filters**: Continue skipping `note`, `assignment`, `open`, `close`, `away_mode_assignment` part types and `bot` author types — these are system/internal. Human admin replies have `part_type: "comment"` and `author.type: "admin"`, which pass through correctly.

### Implementation detail

```text
Current flow:
  Fetch /conversations/{id} → get source + first page of parts → insert

New flow:
  Fetch /conversations/{id} → get source + first page of parts
  → while (next page URL exists) fetch next page, append parts
  → sort all messages by created_at ascending
  → insert
```

The pagination uses the `pages.next` URL from `icData.conversation_parts.pages`. Each subsequent page returns more `conversation_parts` with the same structure.

### Files to edit
- `supabase/functions/import-intercom-ticket/index.ts`

