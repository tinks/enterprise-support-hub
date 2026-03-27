

## Fix triple-send dedup bug in slack-events

### Problem

When a Slack thread reply is forwarded to Intercom, it gets sent 3 times. This is caused by a race condition in the deduplication logic (lines 545-564 of `slack-events/index.ts`).

**Root cause:** Slack retries requests if it doesn't get a response within ~3 seconds. Three concurrent requests arrive for the same `event.ts`. Here's what happens:

1. All 3 requests fetch `mapping` via `select` (line 538) — they all read the **same stale** `last_processed_event_ts` (some old value).
2. The atomic `update` (line 547-553) correctly ensures only **one** request wins the row lock. The first one sets `last_processed_event_ts = eventTs` and gets `claimed.length = 1`.
3. Requests 2 and 3 run the update after request 1 commits. Now `last_processed_event_ts` already equals `eventTs`, so both `IS NULL` and `neq.eventTs` are false → `claimed` is empty.
4. **The bug:** At line 556-558, the code checks `mapping.last_processed_event_ts === eventTs` — but `mapping` is the **stale** object from step 1 (old value, not `eventTs`). So this check is `false`, and requests 2 and 3 **fall through** to the forwarding logic instead of returning early.

### Fix

When `claimed` is empty, **always return early**. If the atomic update didn't match any rows, it means another request already claimed this event — regardless of what the stale `mapping` object says.

**In `supabase/functions/slack-events/index.ts`, replace lines 555-564:**

```typescript
// If no rows were claimed, another request already processed this event
if (!claimed || claimed.length === 0) {
  console.log(`Dedup: event ${eventTs} already claimed for thread ${threadTs}`);
  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
```

This removes the flawed stale-object check and makes the dedup airtight: only the first request to atomically update the row proceeds.

### Summary
- 1 file changed (`supabase/functions/slack-events/index.ts`)
- ~10 lines replaced with ~6 lines
- Fixes the race condition causing triple Intercom messages on Slack retries

