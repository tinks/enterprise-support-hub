

## Import Intercom conversation messages

### Problem
The `import-intercom-ticket` edge function fetches the full Intercom conversation (which includes message parts) but only saves the metadata to `manual_conversations`. It never extracts or stores the individual messages, so the detail page shows "No messages."

### Solution
Extend the edge function to extract messages from the Intercom API response and insert them into the `manual_messages` table.

### Implementation

**`supabase/functions/import-intercom-ticket/index.ts`**

1. After inserting the `manual_conversations` row, extract messages from the Intercom response:
   - The initial message body from `icData.source.body` (the opening message)
   - All conversation parts from `icData.conversation_parts.conversation_parts[]`

2. For each part, map to a `manual_messages` row:
   - `conversation_id` = the newly inserted manual conversation ID
   - `message_text` = strip HTML tags from `part.body` (Intercom returns HTML)
   - `sender_name` = `part.author.name` or `part.author.email` or role
   - `role` = map Intercom author type (`user`/`lead` -> `"user"`, `admin`/`bot` -> `"admin"`)
   - `created_at` = convert `part.created_at` (Unix timestamp) to ISO string

3. Insert the initial source message first (from `icData.source`), then all conversation parts, preserving chronological order.

4. Skip parts with empty/null `body` (e.g., assignment events, status changes).

5. Strip HTML from message bodies using a simple regex (`/<[^>]*>/g` replaced with empty string, then decode common HTML entities).

### Files to edit
- `supabase/functions/import-intercom-ticket/index.ts`

