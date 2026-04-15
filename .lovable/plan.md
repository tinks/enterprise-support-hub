

## Update knowledge files with context-reminder guard changes

The project knowledge file (`.lovable/project-knowledge.md` section 14b) and the memory file (`mem://features/context-reminder`) both describe the old `context-reminder` behavior without the new guards. They need updating.

### Changes

**1. `.lovable/project-knowledge.md` — Section 14b (lines 364-372)**

Update to document that the cron only targets bot-flow conversations (those with `prompt_message_ts`) and skips conversations that already have an Intercom ticket:

```
## 14b. Context Reminder & Auto-Proceed

A cron function (`context-reminder`) runs every 5 minutes and checks for conversations stuck in `awaiting_context`:

- **Only targets bot-flow conversations** — requires `prompt_message_ts IS NOT NULL` (set when the bot posts its "Add Details / Proceed / Cancel" buttons). Conversations where "Awaiting customer" was set manually via the UI are never processed.
- **Safety net:** Also requires `intercom_conversation_id IS NULL` — never auto-proceeds a conversation that already has an Intercom ticket.
- **15 minutes:** Posts a reminder in the Slack thread nudging the user to click "Add Details" or "Proceed"
- **30 minutes:** Automatically creates the Intercom ticket (same as clicking "Proceed") — looks up user email, creates contact + conversation, assigns to Sam

Dedup: `reminder_sent_at` prevents duplicate reminders; atomic status guard prevents double ticket creation. The `prompt_message_ts` column stores the bot's prompt message timestamp so it can be updated via `chat.update`.
```

**2. `mem://features/context-reminder`** — Rewrite to include the guard distinction.

**3. Status table in section 5 (line 91)** — Add a note that `awaiting_context` is also used as the UI "Awaiting customer" status, but the cron only targets bot-flow instances.

### Files to change
- `.lovable/project-knowledge.md` — sections 5 and 14b
- `mem://features/context-reminder` — full rewrite

