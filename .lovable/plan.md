

# Refactor to Event-Driven Flow + Ephemeral Messages + Remove Polling

## Overview

Switch the auto-reply to an ephemeral message (only visible to the requesting user), remove the `poll-slack` function entirely since `slack-events` handles everything in real-time, and update the UI accordingly.

## Changes

### 1. `slack-events/index.ts` — Use ephemeral auto-reply

Replace `chat.postMessage` with `chat.postEphemeral` for the initial context-gathering prompt. This makes the "please provide your email/project" message visible only to the user who mentioned the bot, keeping the channel clean.

```typescript
// Before: visible to everyone
await fetch(`${SLACK_API_URL}/chat.postMessage`, { ... });

// After: only visible to the mentioning user
await fetch(`${SLACK_API_URL}/chat.postEphemeral`, {
  method: "POST",
  headers: slackHeaders,
  body: JSON.stringify({
    channel: channelId,
    user: slackUserId,  // required for ephemeral
    username: BOT_USERNAME,
    icon_emoji: BOT_ICON,
    text: "👋 Thanks for reaching out! To help us assist you faster, please reply in this thread with:\n\n• *Lovable account email* (optional)\n• *Project link or ID* (optional)\n• *Detailed description of your issue*",
  }),
});
```

### 2. Delete `supabase/functions/poll-slack/index.ts`

No longer needed — `slack-events` handles mentions and thread replies in real-time via the Events API.

### 3. Update `src/pages/Index.tsx`

- Remove the "Poll Slack" card (button, state, `pollNow` function)
- Remove `slack_bot_user_id` field (no longer needed — the Events API automatically targets `app_mention` for your bot)
- Remove `last_polled_ts` references
- Add the Slack Events URL to the Webhook URLs card
- Update empty state text to reference @mentioning the bot instead of "click Poll Now"

### 4. Remove `slack_bot_user_id` from settings save

The `slack_bot_user_id` setting is no longer needed since Slack's Events API sends `app_mention` events directly to the bot — no need to configure which user to monitor.

### 5. Update `supabase/config.toml`

Remove the `[functions.poll-slack]` entry (keeping the `slack-events` entry).

## Flow after changes

```text
1. User @mentions bot in Slack channel
2. Slack Events API → slack-events function
3. Bot sends ephemeral message (only user sees it) asking for email/project
4. User replies in thread with context
5. Slack Events API → slack-events function (message event)
6. Function creates Intercom ticket, assigns to AI bot
7. Intercom AI responds → intercom-webhook → threaded Slack reply with 👍/👎 buttons
8. User clicks button → slack-interactions → resolve or escalate
```

