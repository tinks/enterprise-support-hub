

## Add search to conversations table

### What it does
A text search input above the conversations table that filters rows client-side across all visible fields: ID, source, sender name, message/subject, channel, status, product area, and link.

### Changes

**`src/pages/Conversations.tsx`**

1. Add a `searchQuery` state (`useState("")`)
2. Add a search `Input` with a search icon, placed next to the existing source/status filter controls
3. In the `unified` useMemo, after the status filter step, apply a text search filter:
   - Lowercase the query, then check each row's relevant fields:
     - Slack: `id`, `slack_user_id`, user display name, `original_message_text`, channel name, `status`, `product_area`, `intercom_conversation_id`
     - Gmail: `id`, `from_email`, `from_name`, `subject`, `snippet`, `status`, `product_area`
     - Manual: `id`, `contact_name`, `subject`, `source`, `status`, `product_area`
   - If any field contains the search string, keep the row
4. Add `searchQuery` to the useMemo dependency array

**`src/pages/FlowDiagram.tsx`** — Document that conversations table now has a text search filter

### Files to edit
- `src/pages/Conversations.tsx` — state, input, filter logic
- `src/pages/FlowDiagram.tsx` — document change

