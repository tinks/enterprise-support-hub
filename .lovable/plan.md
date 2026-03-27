

## Ignore mentions from users with no Slack user ID

### Problem
Some `app_mention` events arrive without a valid `event.user` (e.g. from integrations or edge cases). These should be silently ignored.

### Fix in `supabase/functions/slack-events/index.ts`

Add a guard right after the existing bot filter (line 252), before line 254:

```typescript
// Ignore mentions with no user ID (e.g. integrations without a real Slack user)
if (!event.user) {
  console.log(`Ignoring app_mention with no user ID`);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
```

### Summary
- 1 file changed (`slack-events/index.ts`)
- ~5 lines added after line 252
- Mentions without a `event.user` are silently ignored

