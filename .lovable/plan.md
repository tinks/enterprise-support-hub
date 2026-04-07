

## Show full Gmail thread messages on conversation detail

### Problem
The Gmail conversation detail page only displays the `snippet` field (a short preview stored during polling). It does not fetch or show the full email thread — there's no equivalent of the Slack `fetch-thread-messages` function for Gmail.

### Solution
Create a new edge function `fetch-gmail-thread` that retrieves all messages in a Gmail thread via the Gmail API, and update the detail page to display them.

### Implementation

**New edge function: `supabase/functions/fetch-gmail-thread/index.ts`**
1. Accept `{ threadId }` in the request body
2. Load Gmail OAuth tokens from `gmail_oauth_tokens`, refresh if expired
3. Call Gmail API `GET /users/me/threads/{threadId}?format=full` to get all messages in the thread
4. For each message, extract: sender (From header), date, plain text body (from `text/plain` part, falling back to `text/html` with HTML stripping), and snippet
5. Return `{ messages: [{ from_name, from_email, date, body, snippet }] }` sorted chronologically

**`src/pages/ConversationDetail.tsx`**
1. Add state `gmailThreadMessages` and a loader flag
2. When a Gmail conversation loads and has a `gmail_thread_id`, invoke `fetch-gmail-thread` with that thread ID
3. Update `renderGmailContent()` to show the full message list (same avatar + message layout as manual/Slack threads) below the metadata card, replacing the snippet card
4. Keep snippet as fallback if thread fetch fails

**`src/pages/FlowDiagram.tsx`**
- Add the new `fetch-gmail-thread` function to the flow diagram

### Files to create/edit
- `supabase/functions/fetch-gmail-thread/index.ts` (new)
- `src/pages/ConversationDetail.tsx`
- `src/pages/FlowDiagram.tsx`

