

## Enhance Intercom search: use customer email + subject matching, strip HTML from titles

### Problems
1. The search currently uses `gmailConv.from_email`, which may be an internal team member's email (when they replied). It should identify the external customer email instead.
2. Intercom conversation titles contain raw HTML tags (e.g., `<p>...</p>`)
3. No subject-based matching — the email subject could help find the right Intercom conversation

### Implementation

**`supabase/functions/search-intercom-by-email/index.ts`**
1. Accept optional `subject` parameter alongside `email`
2. Strip HTML from conversation titles before returning (reuse simple regex `/<[^>]*>/g`)
3. If `subject` is provided, also search Intercom conversations by source body/subject using the Conversations Search API with a second query, then merge and deduplicate results

**`src/pages/ConversationDetail.tsx`**
1. Fix email selection logic: when `from_email` matches the monitored Gmail account (the support DL), use the first email from `to_emails` instead — that's the customer
2. Pass `gmailConv.subject` to the edge function as the `subject` parameter
3. Update the `useEffect` to also consider `to_emails` for determining the search email

### Detail on subject search
The Intercom Conversations Search API supports searching by `source.body` field. We'll run two searches:
- By contact ID (existing logic)
- By subject text match using `source.subject` contains query

Then merge, deduplicate by conversation ID, and return.

### Files to edit
- `supabase/functions/search-intercom-by-email/index.ts`
- `src/pages/ConversationDetail.tsx`
- `src/pages/FlowDiagram.tsx` (update flow to reflect improved lookup logic)

