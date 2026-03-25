

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

