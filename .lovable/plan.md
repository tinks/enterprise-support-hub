

# Polling-Based Slack → Intercom Bridge

## Approach
Replace the event-driven `slack-events` function with a **polling** function (`poll-slack`) that uses the Slack connector gateway to fetch recent messages from monitored channels, filters for messages mentioning a specific user (e.g. `@Joel Samuelson`), and creates Intercom conversations for new ones. No custom Slack app needed.

## How It Works

```text
┌──────────┐  every N seconds   ┌────────────┐   Connector   ┌───────┐
│ Frontend │ ──────────────────► │ poll-slack  │ ──Gateway───► │ Slack │
│ or cron  │   invoke function   │  (edge fn)  │◄─────────────│  API  │
└──────────┘                     └─────┬──────┘               └───────┘
                                       │ new mention found
                                       ▼
                                 ┌────────────┐
                                 │  Intercom   │  create conversation
                                 │    API      │  + assign to bot
                                 └────────────┘
```

1. `poll-slack` calls `conversations.history` via the Slack connector gateway for each monitored channel
2. Filters messages containing `<@USER_ID>` matching the configured Slack user ID (from settings)
3. Skips messages already processed (checks `conversation_mappings` by channel + message ts)
4. For new matches: creates Intercom conversation, assigns to AI bot, stores mapping
5. Stores a `last_polled_ts` per channel in the `settings` table to avoid re-fetching old messages

## Changes

### 1. New edge function: `poll-slack/index.ts`
- Uses Slack connector gateway (`conversations.history`) to fetch recent messages
- Filters for `<@SLACK_BOT_USER_ID>` mentions (the user ID from settings, e.g. your own user ID for testing)
- For each new mention not already in `conversation_mappings`: creates Intercom conversation, assigns it, stores mapping
- Uses `oldest` parameter with a stored timestamp to only fetch new messages

### 2. Update `settings` table
- Add `last_polled_ts` column (text, default empty) to track the last polled timestamp per run

### 3. Update `supabase/config.toml`
- Add `[functions.poll-slack]` with `verify_jwt = false`

### 4. Delete `slack-events` edge function
- No longer needed since we're polling instead of receiving events

### 5. Update `src/pages/Index.tsx`
- Add a "Poll Now" button to manually trigger the polling function
- Add a toggle or interval selector for auto-polling (optional, can use `setInterval` in the UI for testing)
- Remove the "Slack Events URL" from the webhook URLs card since it's no longer needed
- Keep Intercom webhook URL and Slack Interactions URL (those still work as-is since they're triggered by Intercom/Slack respectively — though `slack-interactions` also needs the custom Slack app for button callbacks, which we should note)

### Important caveat
The 👍/👎 button interactions in Slack still require a custom Slack app with an `interactivity` request URL pointing to `slack-interactions`. The polling approach solves the **inbound message detection** problem, but interactive buttons are a Slack platform feature that requires a registered app. For testing, we can skip buttons initially and just verify the Slack → Intercom → Slack reply flow works.

