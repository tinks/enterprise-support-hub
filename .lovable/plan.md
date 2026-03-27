

## Conversation detail page

### Overview
Create a new `/conversations/:id` page that shows full details for a single conversation, with actions to change status, toggle test flag, and quick links to Slack/Intercom. The conversations table rows become clickable to navigate there.

### Steps

**1. Create `src/pages/ConversationDetail.tsx`**

- Fetch the single `conversation_mapping` row by `id` param
- Resolve user name (via `list-slack-users`) and channel name (via `list-slack-channels`)
- Display all fields in a clean card layout:
  - **Header**: Short ID + status badge + test toggle
  - **Details section**: Sent by, channel, created at, updated at, resolved at, original message (full text)
  - **Links section**: Slack thread link, Intercom conversation link
  - **IDs section** (collapsible): All raw IDs (intercom_contact_id, last_intercom_part_id, prompt_message_ts, etc.)
- **Actions toolbar**:
  - Status dropdown (select) to change status to: `active`, `resolved`, `cancelled`, `escalated`, `awaiting_context`
  - Test toggle switch
  - Back button to `/conversations`
- Status changes update the DB via `supabase.from("conversation_mappings").update({ status }).eq("id", id)` — also set `resolved_at = now()` when moving to `resolved`, or clear it when moving away from resolved

**2. Update `src/App.tsx`**

- Add route: `<Route path="/conversations/:id" element={<ConversationDetail />} />`

**3. Update `src/pages/Conversations.tsx`**

- Make each table row clickable — wrap with `useNavigate` and `onClick={() => navigate(`/conversations/${m.id}`)}`
- Add hover styling (`cursor-pointer hover:bg-muted/50`)
- Keep existing click-to-copy on the `#` cell (use `stopPropagation`)

### Files changed
- `src/pages/ConversationDetail.tsx` (new)
- `src/App.tsx` (add route)
- `src/pages/Conversations.tsx` (make rows clickable)
- No database changes needed

