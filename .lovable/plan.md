

## Ignore bot-triggered @mentions in slack-events

### Problem
Another Slack bot mentioned @Ask Lovable in a thread, which triggered the full conversation flow. Bot-originated mentions should be ignored entirely.

### Fix in `supabase/functions/slack-events/index.ts`

Add an early return at the top of the `app_mention` handler (after line 245) that skips the event if it came from a bot. Slack `app_mention` events from bots include a `bot_id` field or have `subtype === "bot_message"`. We can also check `event.bot_id` or look up the user via `users.info` to confirm `is_bot`.

The simplest and most reliable approach: check for `event.bot_id` on the event payload. If present, return early.

```typescript
// Inside the app_mention handler, right after line 245:
if (event.bot_id || event.subtype === "bot_message") {
  console.log(`Ignoring app_mention from bot (bot_id=${event.bot_id}, subtype=${event.subtype})`);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
```

### Summary
- 1 file changed (`supabase/functions/slack-events/index.ts`)
- ~5 lines added after the `if (event.type === "app_mention")` check
- Any bot mentioning @Ask Lovable will be silently ignored
- No flow diagram change needed (this is a filter, not a logic change)

