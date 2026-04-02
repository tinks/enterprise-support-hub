

## Distinguish Slack bot vs Slack import source labels

### What it does
Slack rows in the conversations table will show different source badges based on origin:
- **Slack bot** — conversations created automatically by the bot (have an `intercom_conversation_id`)
- **Slack import** — threads imported manually via the import page (no `intercom_conversation_id`)

### Changes

**`src/pages/Conversations.tsx`**

1. In `renderSlackCell`, update the `"source"` case (line 713): check if `m.intercom_conversation_id` is truthy. If yes, render "Slack bot" badge; if no, render "Slack import" badge. Use slightly different badge styling to visually distinguish them (e.g., `variant="outline"` for bot, `variant="secondary"` for import).

2. Update source filter dropdown labels (lines 1098-1099): rename "Slack only" to "Slack bot" and "Slack import" stays as is.

**`src/pages/FlowDiagram.tsx`** — Document the label distinction.

### Files to edit
- `src/pages/Conversations.tsx`
- `src/pages/FlowDiagram.tsx`

