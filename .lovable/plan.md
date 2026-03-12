

## Editable Bot Messages via Flow Diagram

Yes, this is absolutely doable. The idea: store all bot-facing message templates in the database, have the edge functions read them at runtime instead of using hardcoded strings, and make the flow diagram an editor where team members can click on any message to edit it inline.

### Identified Bot Messages (currently hardcoded)

| Key | Current Text | Edge Function |
|-----|-------------|---------------|
| `context_prompt` | "👋 Optionally add your Lovable account email..." | `slack-events` |
| `ticket_created_ack` | "✅ Thanks! Generating a response..." | `slack-interactions` |
| `feedback_positive` | "✅ Glad that helped! Marking as resolved." | `slack-interactions` |
| `escalation_notice` | "🔄 Escalating to human support. A ticket has been created..." | `slack-interactions` |
| `reply_forwarded` | "🔄 Your reply has been sent. A member of our Enterprise support team..." | `slack-events` |
| `conversation_closed` | "✅ This issue has been marked as resolved. If you need further help..." | `intercom-webhook` |

### Database Change

Create a `bot_messages` table:

```text
bot_messages
├── id (uuid, PK)
├── message_key (text, unique) — e.g. "context_prompt"
├── message_text (text) — the actual message content
├── description (text) — explains when this message is sent
├── updated_at (timestamptz)
└── created_at (timestamptz)
```

Seed it with the 6 messages above.

### Edge Function Changes

Each edge function will:
1. Query `bot_messages` table for the relevant key(s) at the start of execution
2. Use the DB value instead of the hardcoded string
3. Fall back to the hardcoded default if the DB query fails (resilience)

This adds one lightweight query per invocation but ensures real-time editability.

### Flow Diagram Changes (`FlowDiagram.tsx`)

1. Fetch `bot_messages` from the database on page load
2. Display actual DB values in each node's message preview
3. Make message blocks clickable — clicking opens an inline edit mode (textarea replaces the message preview)
4. Save button writes back to `bot_messages` table
5. Show a subtle "edit" icon on hover over editable messages
6. Toast notification on save success

### What stays static

Node titles, descriptions, details lists, and the diagram structure itself remain hardcoded in the component — only the **bot message text** (the mono-styled preview blocks) becomes editable. This keeps the scope focused and practical.

### Summary

- 1 new DB table (`bot_messages`) seeded with 6 rows
- 3 edge functions updated to read messages from DB
- Flow diagram component updated with inline editing
- No auth required (matches existing RLS pattern with public access)

