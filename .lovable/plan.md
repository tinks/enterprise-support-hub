

## Auto-import Intercom conversations on assignment to enterprise inbox

### How it works

When Intercom fires an assignment webhook (`conversation.admin.assigned`, `conversation.admin.open.assigned`, `ticket.admin.assigned`, `ticket.team.assigned`), the existing `intercom-webhook` function will:

1. Detect it's an assignment topic
2. Extract the assigned team/inbox ID from the payload
3. Compare against `settings.intercom_inbox_id` (enterprise inbox)
4. If it doesn't match the enterprise inbox → ignore
5. If it matches → check if the conversation already exists in `conversation_mappings`, `gmail_conversations`, or `manual_conversations`
6. If already tracked → ignore
7. If new → fetch the full conversation from Intercom API (with pagination), extract messages using the same logic as `import-intercom-ticket`, and insert into `manual_conversations` + `manual_messages`

### Technical detail

**Assignment webhook payload** provides:
- `body.data.item.id` — the conversation/ticket ID
- `body.data.item.admin_assignee_id` or `body.data.item.team_assignee_id` — who it's assigned to
- For ticket topics: `body.data.item.ticket.id`

The auto-import reuses the exact message extraction logic from `import-intercom-ticket`: `stripHtml`, pagination of conversation parts, `SKIP_PART_TYPES` filter, bot author filter, chronological sorting.

The Intercom conversation URL is constructed as `https://app.intercom.com/a/inbox/.../conversation/{id}` for the `link` field stored in `manual_conversations`.

### Changes

**`supabase/functions/intercom-webhook/index.ts`**

1. Add `ASSIGNMENT_TOPICS` constant: `["conversation.admin.assigned", "conversation.admin.open.assigned", "ticket.admin.assigned", "ticket.team.assigned"]`
2. Update the topic gate (line 139) to also accept assignment topics
3. Add new handler block for assignment topics (before the reply/close handling):
   - Extract `team_assignee_id` from payload
   - Compare against `appSettings.intercom_inbox_id`
   - If no match → return early
   - Check all three tables for existing `intercom_conversation_id`
   - If found → return early (already tracked)
   - If new → fetch full conversation from Intercom API with pagination, extract messages with `stripHtml` + filtering, insert into `manual_conversations` + `manual_messages`
   - Return success with the new conversation ID
4. Add `stripHtml` helper function to the file (same as in `import-intercom-ticket`)

**`src/pages/FlowDiagram.tsx`**
- Add a node for the auto-import-on-assignment path showing the new flow

### Files to edit
- `supabase/functions/intercom-webhook/index.ts`
- `src/pages/FlowDiagram.tsx`

