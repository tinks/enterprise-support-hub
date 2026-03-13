

## Fix: Duplicate context prompt messages

### Root Cause
Classic TOCTOU (time-of-check-time-of-use) race condition. Slack retries `app_mention` events if the response takes >3 seconds. The current flow is:

1. SELECT to check if mapping exists (line 256) — both requests find nothing
2. POST prompt message to Slack (line 309) — both send the message
3. INSERT mapping (line 355) — one succeeds, one fails silently

### Fix — `supabase/functions/slack-events/index.ts`

Reverse the order: **INSERT first, send message second**.

1. Attempt an atomic INSERT with conflict handling — use `.upsert()` with `onConflict` and `ignoreDuplicates: true`, or raw SQL insert. If 0 rows returned, it's a duplicate — exit immediately.
2. Only after the INSERT succeeds (proving we "own" this thread), send the prompt message to Slack.
3. Remove the SELECT-based idempotency check entirely.

```text
BEFORE:                          AFTER:
SELECT (check)                   INSERT ... ON CONFLICT DO NOTHING
  ↓ (race window)                  ↓ (no race — atomic)
POST message (both fire)         if 0 rows → return (duplicate)
INSERT (one fails)               POST message (only winner fires)
```

Specifically, replace lines 253-365 with:
- Attempt insert with `slack_channel_id + slack_thread_ts` and use the unique index. Use `.upsert({ onConflict: 'slack_channel_id,slack_thread_ts', ignoreDuplicates: true })` and check the result — if no row returned, another request already claimed it.
- Move the prompt message POST and thread-fetching logic to after the successful insert.
- If needed, update the mapping row with `original_message_text` and `slack_user_id` after fetching thread context (since we insert first with placeholder values).

### Scope
One file: `supabase/functions/slack-events/index.ts`. No schema changes (unique index already exists).

