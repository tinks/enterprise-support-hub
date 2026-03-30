

## Add Intercom ID column to conversations table

### Problem
The Conversations page table doesn't show the Intercom conversation/ticket ID anywhere, even though `conversation_mappings.intercom_conversation_id` stores it.

### Changes

**File: `src/pages/Conversations.tsx`**

1. Add a new "Intercom" column header between "Link" and "Status".
2. For Slack rows: display the `intercom_conversation_id` as a clickable link to Intercom (`https://app.intercom.com/a/apps/<app_id>/conversations/<id>`), or show "—" if empty.
3. For Gmail rows: show "—" (no Intercom mapping).

**File: `src/pages/FlowDiagram.tsx`**
- No logic change needed — this is a UI-only addition.

### Technical detail
- The `intercom_conversation_id` field already exists on `ConversationMapping` interface and is fetched from the database.
- The Intercom deep-link format is `https://app.intercom.com/a/apps/{app_id}/conversations/{conversation_id}`. The app ID can be hardcoded or pulled from settings. For simplicity, will link using the conversation ID directly.

