

## Problem

`chat.postEphemeral` with `thread_ts` is unreliable in Slack — ephemeral messages in threads have known limitations and often don't appear, especially when the "thread" is just a single message (the mention itself, not yet a real thread). The logs confirm the function ran successfully, so the API call was made but the ephemeral message simply isn't rendering in Slack.

## Fix

Switch from `chat.postEphemeral` to `chat.postMessage` with `thread_ts` for the auto-reply. This makes the prompt visible to everyone in the thread, but it reliably appears. The trade-off is worth it — the prompt is a short, helpful message that doesn't clutter the channel since it's threaded.

### Change in `supabase/functions/slack-events/index.ts`

Replace the `chat.postEphemeral` call (~line 187) with `chat.postMessage`:

```typescript
// Before
await fetch(`${SLACK_API_URL}/chat.postEphemeral`, {
  body: JSON.stringify({
    channel: channelId,
    user: slackUserId,      // ephemeral-specific field
    thread_ts: threadTs,
    username: BOT_USERNAME,
    icon_emoji: BOT_ICON,
    text: "...",
  }),
});

// After
await fetch(`${SLACK_API_URL}/chat.postMessage`, {
  body: JSON.stringify({
    channel: channelId,
    thread_ts: threadTs,     // posts as threaded reply
    username: BOT_USERNAME,
    icon_emoji: BOT_ICON,
    text: "...",
  }),
});
```

Single line change — swap the endpoint and remove the `user` field.

