

## Allow detail view and Intercom ticket creation for manual/Gmail conversations

### What it does
1. Makes manual and Gmail rows clickable to open a detail view (currently only Slack rows navigate to `/conversations/:id`)
2. Adds a "Create Intercom ticket" button in the Intercom column for Gmail and manual conversations that don't have an Intercom ID yet

### Problem
- Manual rows have no `onClick` / `cursor-pointer` — they're not navigable
- Gmail rows only navigate when not grouped; ungrouped Gmail rows also lack navigation
- The "Create" button in the Intercom column only appears for Slack rows (`showCreateButton` is only passed for Slack)
- The `create-intercom-from-import` edge function only queries `conversation_mappings` — it won't find Gmail or manual rows

### Changes

**`src/pages/Conversations.tsx`**

1. **Manual rows**: Add `cursor-pointer` class and `onClick={() => navigate(...)}` to manual `TableRow` — but we need a detail page that works for manual sources. Since the current `/conversations/:id` page only loads from `conversation_mappings`, we'll create a lightweight detail route or adapt the existing one.

2. **Gmail/Manual Intercom "Create" button**: Pass `showCreateButton=true` and an `onCreateClick` handler to `renderIntercomCell` for Gmail and manual rows. The handler will call a new edge function variant (or an updated `create-intercom-from-import`) that accepts a `source` param and reads from the correct table.

3. **Gmail row navigation**: For non-grouped Gmail rows, add click-to-navigate behavior.

**`supabase/functions/create-intercom-from-import/index.ts`**

Update the edge function to accept an optional `source` parameter (`"slack"`, `"gmail"`, `"manual"`). Based on source:
- `slack` (default): current behavior — read from `conversation_mappings`, fetch Slack thread
- `gmail`: read from `gmail_conversations`, use the email subject/snippet as the transcript body, use `from_email` for the Intercom contact
- `manual`: read from `manual_conversations` + `manual_messages`, use the messages as the transcript, use `contact_name` for the Intercom contact

All three paths converge on the same Intercom contact find/create + conversation create + assignment logic that already exists.

**`src/pages/ConversationDetail.tsx`**

Extend to support Gmail and manual sources:
- Accept an optional `?source=gmail` or `?source=manual` query param
- When source is `gmail`, load from `gmail_conversations` instead of `conversation_mappings`
- When source is `manual`, load from `manual_conversations` and `manual_messages`
- Adapt the detail card fields to show relevant info per source (email fields for Gmail, contact/subject for manual)
- Hide Slack-specific UI (thread, channel) when source isn't Slack

**`src/pages/FlowDiagram.tsx`** — Document the changes.

### Technical details

```text
Conversations table row click behavior:
  Slack  → /conversations/{id}              (existing)
  Gmail  → /conversations/{id}?source=gmail  (new)
  Manual → /conversations/{id}?source=manual (new)

create-intercom-from-import accepts:
  { mappingId, source? }
  source defaults to "slack" for backward compatibility
```

### Files to edit
- `src/pages/Conversations.tsx` — row navigation + Create button for all sources
- `src/pages/ConversationDetail.tsx` — multi-source detail view
- `supabase/functions/create-intercom-from-import/index.ts` — support Gmail/manual sources
- `src/pages/FlowDiagram.tsx` — document changes

