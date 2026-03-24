

## Add 15-Minute Reminder and 30-Minute Auto-Proceed for Context Prompt

### Problem
Users sometimes miss the "Add Details" / "Proceed" buttons and get stuck in `awaiting_context` status indefinitely.

### Solution
Create a new edge function `context-reminder` that runs on a cron schedule (every 5 minutes) and:

1. **At 15 minutes** — Posts a reminder message in the Slack thread nudging the user to click "Add Details" or "Proceed"
2. **At 30 minutes** — Automatically triggers the "Proceed" flow (creates the Intercom ticket with no extra context)

### Technical Details

**New file: `supabase/functions/context-reminder/index.ts`**

A scheduled function that:
1. Queries `conversation_mappings` for rows where `status = 'awaiting_context'` and `created_at` is older than 15 minutes
2. For rows 15-30 minutes old with no reminder sent yet:
   - Posts a Slack thread reminder: "Hey! Just a reminder — click *Add Details* to share your email/project info, or *Proceed* to continue without it. If no action is taken, we'll automatically proceed in 15 minutes."
   - Marks reminder sent (add a `reminder_sent_at` column)
3. For rows 30+ minutes old:
   - Updates the prompt message to indicate auto-proceeding
   - Calls `createIntercomTicket` logic (same as "Proceed" button) — specifically: looks up the Slack user's email via `users.info`, creates the Intercom contact + conversation, assigns to Sam, updates status
   - This reuses the same ticket creation pattern from `slack-interactions`

**Database migration:**
- Add `reminder_sent_at` (nullable timestamp) column to `conversation_mappings`
- Add `prompt_message_ts` (nullable text) column to `conversation_mappings` to store the bot's prompt message timestamp (needed to update it later)

**Modify: `supabase/functions/slack-events/index.ts`**
- After posting the context prompt (line 371), save `promptData.ts` to `conversation_mappings.prompt_message_ts` so the reminder function can reference and update the prompt message

**New bot message key: `context_reminder`**
- Add a `context_reminder` row to `bot_messages` for the reminder text, making it editable from the Flow Diagram

**Cron setup:**
- Configure via `supabase/config.toml` or use `pg_cron` to invoke the function every 5 minutes

### Flow
```text
0 min  → Bot posts context prompt (status: awaiting_context)
15 min → Cron posts reminder in thread
30 min → Cron auto-proceeds: creates ticket, updates status to processing → active
```

### Edge Cases
- If user clicks a button between reminder and auto-proceed, the atomic status guard (`eq status awaiting_context`) prevents double-processing
- The cron function is idempotent — `reminder_sent_at` prevents duplicate reminders, and the atomic status update prevents duplicate ticket creation

