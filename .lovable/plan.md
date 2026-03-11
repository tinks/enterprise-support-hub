

## Diagnosis

The `missing_scope` error could be from a stale test (before the new token took effect), OR the Slack API response contains a `needed` field telling us exactly which scope is missing — but our code doesn't log it.

## Plan

### 1. Improve error logging in `slack-events` edge function

In `supabase/functions/slack-events/index.ts`, line 186, change the error log to also print `repliesData.needed` and `repliesData.response_metadata`:

```typescript
console.error(`conversations.replies error: ${repliesData.error}, needed: ${repliesData.needed}, metadata: ${JSON.stringify(repliesData.response_metadata)}`);
```

This will tell us exactly which scope Slack wants.

### 2. Test again

After deploying, tag the bot in a thread again. The improved logs will either:
- **Succeed** (meaning the old logs were stale, from before the token update)
- **Fail with a specific scope name** so we know exactly what to fix

This is a one-line logging change to get actionable diagnostic info.

