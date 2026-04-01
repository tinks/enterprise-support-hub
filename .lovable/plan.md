

## Add free-form conversation log

### What it does
A new "Log conversation" section on the Import page that lets you manually create a conversation with back-and-forth messages. Useful for Teams threads or any source that isn't Slack/Gmail.

### Database changes

**New table: `manual_conversations`**
- `id` (uuid, PK)
- `source` (text) — e.g. "teams", "phone", "other"
- `contact_name` (text) — who the user/customer is
- `subject` (text) — conversation topic
- `link` (text, nullable) — optional external link (e.g. Teams thread URL)
- `status` (text, default "active")
- `is_bug`, `is_feature_request`, `is_test` (boolean, default false)
- `product_area` (text, nullable)
- `created_at`, `updated_at` (timestamptz)

**New table: `manual_messages`**
- `id` (uuid, PK)
- `conversation_id` (uuid, FK → manual_conversations)
- `role` (text) — "user" or "admin"
- `sender_name` (text)
- `message_text` (text)
- `created_at` (timestamptz)

RLS: public read + insert + update on both tables (matching existing pattern). Deny delete.

### UI changes

**`src/components/ManualLogTab.tsx`** (new)
A form-based component with two sections:

1. **Conversation header** — source dropdown (Teams, Phone, Other + free text), contact name, subject, optional link
2. **Message builder** — a list of messages you build up before saving:
   - Each message has: role toggle (User / Admin), sender name, message text
   - "Add message" button appends a new empty row
   - Messages are displayed in order with role indicators
3. **Save button** — inserts the conversation + all messages in one go
4. **Recently logged** — list of recent manual conversations (last 10), clickable to view

**`src/pages/ImportPage.tsx`**
- Add the `ManualLogTab` component below the existing `ImportTab`

**`src/pages/Conversations.tsx`**
- Add "manual" as a new source filter option alongside "all", "slack", "gmail"
- Fetch manual_conversations and include them in the unified rows
- Render them with source badge "Manual" and appropriate columns

**`src/pages/FlowDiagram.tsx`** — document the new manual log feature

### Files to create/edit
- Database migration (2 new tables + RLS policies)
- `src/components/ManualLogTab.tsx` (new)
- `src/pages/ImportPage.tsx` — add ManualLogTab
- `src/pages/Conversations.tsx` — add manual source filter + data fetch
- `src/pages/FlowDiagram.tsx` — document change

