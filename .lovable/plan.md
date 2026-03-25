

## Add Direct Message Support for Slack Workspace Members

### What to add in Slack App settings (at https://api.slack.com/apps)

1. **OAuth & Permissions → Bot Token Scopes**: Add `im:history`
2. **Event Subscriptions → Subscribe to bot events**: Add `message.im`
3. **Reinstall the app** to your workspace after making these changes (Slack will prompt you)

### Code Change

**File: `supabase/functions/slack-events/index.ts`**

Add a new handler block **between** the `app_mention` block (ends ~line 390) and the thread-reply handler (starts ~line 394). This new block catches top-level DM messages:

```typescript
// ===== Handle DM messages (workspace members only) =====
if (
  event.type === "message" &&
  event.channel_type === "im" &&
  !event.thread_ts &&
  !event.bot_id &&
  event.user &&
  event.user !== expectedBotId &&
  (!event.subtype || event.subtype === "file_share")
) {
  const channelId = event.channel;
  const threadTs = event.ts; // DM message itself becomes the thread root

  // Atomic claim (same pattern as app_mention)
  const { data: claimed } = await supabase
    .from("conversation_mappings")
    .upsert({ ... same fields as app_mention ... })
    .select("id");

  if (!claimed || claimed.length === 0) {
    // Already processed
    return ok response;
  }

  // Post context prompt with Add Details / Proceed / Cancel buttons
  // (identical block kit as app_mention)
}
```

The handler reuses the exact same prompt-posting logic as `app_mention`. The downstream flow (thread replies, ticket creation, Intercom relay, reminders) all works unchanged — it's all keyed on `slack_channel_id` + `slack_thread_ts`.

### What stays the same
- Context modal, ticket creation, Intercom relay, escalation, cancel, reminders — all unchanged
- Thread replies in the DM are already handled by the existing message handler (line 394) which works regardless of channel type
- External users cannot DM the bot (Slack limitation — bot is not installed in their workspace)

### Summary
- One edge function file updated (new ~50-line handler block)
- No database changes
- Two Slack app config changes (scope + event subscription) + reinstall

---

## SMS Notifications for New Support Questions

### Overview
When toggled on, every new @mention or DM to the bot sends an SMS to your phone with the question summary, so you can monitor incoming requests in real time.

### Phase 1 — Connect Twilio
- Use the Twilio connector to link your Twilio account (handles auth automatically via the gateway)
- You'll need a Twilio phone number that can send SMS

### Phase 2 — Database: Add settings fields
- Add three columns to the `settings` table:
  - `sms_notifications_enabled` (boolean, default false)
  - `sms_phone_number` (text, nullable) — your phone number in E.164 format
  - `sms_from_number` (text, nullable) — your Twilio phone number
- No new tables needed

### Phase 3 — Edge function: Send SMS on new question
- In `supabase/functions/slack-events/index.ts`, after the context prompt is posted (both `app_mention` and DM handlers), check if SMS is enabled in settings
- If enabled, fire an SMS via the Twilio connector gateway with:
  - **To**: the configured phone number
  - **From**: the Twilio number
  - **Body**: a short summary — e.g. `"New Ask Lovable question from @{user} in #{channel}: {first 100 chars of message}"`
- This is a fire-and-forget call (don't block the Slack response)

### Phase 4 — UI: Toggle and phone number input
- Add a new section to the Settings page (`src/pages/Index.tsx`) with:
  - A toggle switch for "SMS notifications"
  - An input for your phone number (with E.164 placeholder like `+1234567890`)
  - An input for your Twilio "From" number
  - A "Send test SMS" button to verify the setup
- Save these fields alongside existing settings

### Phase 5 — Test edge function for "Send test SMS"
- Create a small `send-test-sms` edge function that reads settings and sends a test message
- Called from the UI's test button

### What's needed from you
1. A Twilio account with an SMS-capable phone number
2. Your personal phone number to receive notifications

### Summary
- 1 connector setup (Twilio)
- 1 migration (3 new columns on `settings`)
- 1 new edge function (`send-test-sms`)
- 1 edge function updated (`slack-events` — add ~15 lines)
- 1 UI file updated (`Index.tsx` — new settings section)
