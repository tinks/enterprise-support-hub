

## Fix: Slack message being resent to Intercom (Slack retry causing duplicates)

### Root cause

Slack retries event deliveries if it doesn't receive a 200 response within **3 seconds**. The `slack-events` function does heavy work synchronously before returning: downloading/uploading files, forwarding to Intercom, scanning thread messages to remove buttons, and updating the DB. If any of this takes >3s, Slack retries the exact same event, and the message gets forwarded to Intercom again — there's no idempotency guard for thread reply events (unlike `app_mention` which checks for existing mappings).

This explains the duplicate "what do you see in the screenshot?" messages and multiple "Sam is working..." notices in Intercom.

### Fix (two parts)

**1. Return 200 immediately, process in background**

Wrap all the heavy processing for thread replies in `EdgeRuntime.waitUntil()` (same pattern already used in `slack-interactions`). Return the 200 response to Slack right away so it doesn't retry.

**2. Deduplicate by event timestamp**

Add an idempotency check using `event.ts` (unique per Slack message). Before processing a thread reply, check a simple dedup mechanism — store the last processed `event.ts` per thread in the mapping row (new column `last_processed_event_ts`), and skip if already seen.

### Implementation

**A. Database migration** — add `last_processed_event_ts` text column to `conversation_mappings`:
```sql
ALTER TABLE public.conversation_mappings 
ADD COLUMN IF NOT EXISTS last_processed_event_ts text;
```

**B. `slack-events/index.ts`** — two changes in the thread reply handler (line 377+):

1. After finding the mapping, atomically set `last_processed_event_ts = event.ts` with a WHERE condition `last_processed_event_ts IS DISTINCT FROM event.ts`. If no rows updated, it's a retry — skip processing.

2. Wrap the heavy work (Intercom forwarding, button removal, status transition) in `EdgeRuntime.waitUntil()` and return 200 immediately.

```text
Slack event arrives
  ↓
Return 200 immediately
  ↓ (background via waitUntil)
Check event.ts dedup → skip if already processed
  ↓
Forward to Intercom, remove buttons, update status
```

### Scope
- 1 migration (add column)
- 1 edge function edit (`slack-events/index.ts`)
- No UI changes

