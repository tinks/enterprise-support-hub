# Fix: "👍 This resolves my issue" button silently no-ops

## Root cause
In `supabase/functions/slack-interactions/index.ts` (line 1451), the atomic guard that gates `feedback_positive`/`feedback_negative` only accepts these statuses:

```ts
.in("status", ["active", "awaiting_context", "escalated"])
```

Logs for the failing thread (mapping `9fdc6d73…`, Intercom `215474223263405`) show its status was `awaiting_customer` (set by `slack-events` when an employee replied: "Set conversation … status to awaiting_customer (Slack reply from employee)"). That status is not in the whitelist, so the UPDATE matches 0 rows and the handler logs the misleading "Feedback guard: feedback_positive skipped … already processed" and returns. Result: nothing happens in Slack or Intercom.

In production today there are 10 mappings sitting in `awaiting_customer`, 7 in `awaiting_support`, 4 in `awaiting_engineering`, 1 in `processing` — clicking the button on any of them currently does nothing.

## Fix

### 1. `supabase/functions/slack-interactions/index.ts`
Expand the guard to include every non-terminal status, i.e. everything except already-`resolved` and `cancelled`:

```ts
.not("status", "in", "(resolved,cancelled)")
```

This way:
- First click transitions from any open state → `resolved`/`escalated` and proceeds with the close + CSAT flow.
- Subsequent clicks correctly hit the "already processed" branch (status is now `resolved`).

Also tweak the log line to be accurate ("guard: not in updatable state").

### 2. Better log message
Change "skipped … already processed" to also include the actual current status, so future debugging is one log read.

## Verification
- Reproduce: pick a mapping in `awaiting_customer`, click 👍 → conversation should now resolve, close in Intercom, and post the CSAT block (per the previous fix).
- Click 👍 again → should hit the guard branch and no-op.

## Out of scope
- Backfilling missing CSAT prompts for the 3 mappings that hit this bug today (215474223263405 and friends). Can be a follow-up if you want.
- Re-thinking the `awaiting_*` taxonomy (separate concern).
