

## Make status editable inline on conversations list

### What it does
Replaces the static status badge in each conversation row with a clickable `<Select>` dropdown, so you can change the status directly from the list without opening the detail view.

### Changes

**`src/pages/Conversations.tsx`**

1. Add a `STATUS_OPTIONS` constant (same as in ConversationDetail): `["active", "resolved", "cancelled", "escalated", "awaiting_context", "awaiting_support"]`

2. Add an `updateStatus` function that:
   - Determines the correct table (`conversation_mappings`, `gmail_conversations`, or `manual_conversations`) based on source
   - Calls `supabase.from(table).update({ status: newStatus }).eq("id", rowId)`
   - Updates local state (`setMappings`, `setGmailRows`, `setManualRows` and `searchResults`)
   - Shows toast on error

3. Replace the three `case "status"` blocks (Slack ~line 806, Gmail ~line 943, Manual ~line 1034) from a static `<Badge>` to a `<Select>` dropdown styled compactly (similar to the classification dropdown), showing the current status label and allowing selection of any status option. Click events will be stopped from propagating to avoid triggering row navigation.

**`src/pages/FlowDiagram.tsx`**
- Document that status can now be edited inline from the conversations list

### Files to edit
- `src/pages/Conversations.tsx`
- `src/pages/FlowDiagram.tsx`

