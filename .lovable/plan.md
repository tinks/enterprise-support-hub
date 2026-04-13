

## Add audit logs to conversations

### What it does
Every time someone changes a conversation field (status, owner, product area, classification, incident toggle, test toggle, or links an Intercom ticket), an audit log entry is recorded with who made the change and when. A collapsible "Activity log" section on the conversation detail page shows the full history.

### Database

**New table: `conversation_audit_logs`**
- `id` (uuid, PK, default `gen_random_uuid()`)
- `conversation_id` (uuid, not null)
- `conversation_source` (text, not null) — `slack`, `gmail`, `manual`
- `action` (text, not null) — e.g. `status_changed`, `owner_changed`, `product_area_changed`, `classification_changed`, `is_bug_toggled`, `is_test_toggled`, `intercom_linked`, `reply_sent`
- `old_value` (text, nullable)
- `new_value` (text, nullable)
- `performed_by` (text, not null, default `''`) — reuses the `note_author` from localStorage
- `created_at` (timestamptz, default `now()`)

RLS: public SELECT and INSERT allowed (matches existing pattern). No UPDATE or DELETE.

### Code changes

**`src/pages/ConversationDetail.tsx`**
- Add a helper `logAudit(action, oldValue, newValue)` that inserts into `conversation_audit_logs` using the conversation id, source, and `localStorage.getItem("note_author")` as `performed_by`.
- Call `logAudit` from `updateStatus`, `updateOwner`, `updateProductArea`, `updateClassification`, `toggleField`, `linkIntercomConversation`, `createIntercom`, and `sendReply`.
- Add an "Activity log" collapsible card in the right sidebar (below the existing metadata cards) that loads and displays audit entries sorted newest-first, showing action description, old→new values, who, and when.
- If `performed_by` is empty (no name set), prompt or use "Unknown" — same pattern as notes.

**`src/pages/FlowDiagram.tsx`**
- Document the new audit log table and its integration.

### Files to edit
- SQL migration (create `conversation_audit_logs` table + RLS)
- `src/pages/ConversationDetail.tsx`
- `src/pages/FlowDiagram.tsx`

