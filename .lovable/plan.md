

## Make test review rows clickable + add delete for all conversation types

### Problem
1. Rows on `/test-review` aren't clickable — you can't navigate to the conversation detail page.
2. The detail page only allows deleting manual-source conversations. You want to delete any conversation regardless of source.

### Changes

**`src/pages/TestChannelReview.tsx`**
- Make each `TableRow` clickable: `onClick={() => navigate(`/conversations/${row.id}`)}` with `cursor-pointer` styling
- Add `useNavigate` import from react-router-dom
- Use `e.stopPropagation()` on all interactive elements in the row (checkbox, buttons, popovers) to prevent navigation when clicking actions

**`src/pages/ConversationDetail.tsx`**
- Move the "Delete conversation" card outside the `source === "manual"` condition so it appears for all sources
- For Slack (`conversation_mappings`) and Gmail (`gmail_conversations`) sources, use the existing `delete-conversation-mapping` edge function for Slack, and add a similar service-role delete for Gmail
- For Slack: call `delete-conversation-mapping` edge function with the conversation ID
- For Gmail: add a new edge function `delete-gmail-conversation` or reuse the pattern — but since `gmail_conversations` also has RLS deny-delete, use an edge function
- Actually, simplest approach: generalize the `delete-conversation-mapping` edge function to accept a `table` parameter, or create one more small edge function for Gmail

**`supabase/functions/delete-conversation-mapping/index.ts`**
- Add optional `table` parameter: `"conversation_mappings"` (default), `"gmail_conversations"`, or `"manual_conversations"`
- Validate the table name against an allowlist to prevent SQL injection
- Delete from the specified table by ID using service role

**`src/pages/FlowDiagram.tsx`**
- Note that any conversation can be deleted from the detail page

### Files to edit
- `src/pages/TestChannelReview.tsx` — make rows clickable
- `src/pages/ConversationDetail.tsx` — enable delete for all sources
- `supabase/functions/delete-conversation-mapping/index.ts` — support multiple tables
- `src/pages/FlowDiagram.tsx` — update notes

