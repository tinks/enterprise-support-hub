

## Auto-find existing Intercom conversation for Gmail threads

### Problem
Gmail threads often already have an associated Intercom conversation created through other channels. Currently there's no way to discover this — users must manually search Intercom and paste the ID.

### Solution
Create an edge function that searches Intercom by the sender's email address and returns matching conversations. When a Gmail conversation detail page loads without an `intercom_conversation_id`, automatically search Intercom and show suggestions the user can link with one click.

### Implementation

**New edge function: `supabase/functions/search-intercom-by-email/index.ts`**
1. Accept `{ email: string }` in the request body
2. Use Intercom Contacts Search API to find the contact by email
3. If found, use Intercom Conversations Search API to list recent conversations for that contact
4. Return `{ conversations: [{ id, title, created_at }] }` — up to 10 results

**`src/pages/ConversationDetail.tsx`**
1. When `source === "gmail"` and `gmailConv` loads with no `intercom_conversation_id`, call the new edge function with `gmailConv.from_email`
2. Show a small "Existing Intercom conversations" section in the sidebar (below the "Create Intercom ticket" button) listing matches
3. Each match shows the conversation ID and a truncated subject/title, with a **Link** button
4. Clicking **Link** updates `gmail_conversations.intercom_conversation_id` with the selected Intercom conversation ID and refreshes the UI
5. Also sync the `intercom_conversation_id` to sibling Gmail threads (same `gmail_thread_id`) for consistency

**`src/pages/FlowDiagram.tsx`**
- Update flow diagram to reflect the new Intercom lookup step for Gmail conversations

### Files to edit
- `supabase/functions/search-intercom-by-email/index.ts` (new)
- `src/pages/ConversationDetail.tsx`
- `src/pages/FlowDiagram.tsx`

