

## Fix thread reply forwarding regression

### Root cause
In `slack-events/index.ts`, the atomic dedup claim for thread replies uses `.is("last_processed_event_ts", null).or(...)` which are two separate PostgREST filters ANDed together. The intended logic is `IS NULL OR != eventTs`, but the actual filter is `IS NULL AND != eventTs` — always false when the column is NULL. This means the first thread reply in any conversation can never be claimed, so:
1. The reply is never forwarded to Intercom
2. The cosmetic work (status transition, notices) never runs

### Fix

**File: `supabase/functions/slack-events/index.ts`**

Replace the dedup claim (lines 563-569):
```js
// Before (broken):
.eq("id", mapping.id)
.is("last_processed_event_ts", null)
.or(`last_processed_event_ts.neq.${eventTs}`)

// After (fixed):
.eq("id", mapping.id)
.or(`last_processed_event_ts.is.null,last_processed_event_ts.neq.${eventTs}`)
```

This puts both conditions inside a single `.or()` call, producing the correct PostgREST filter: `id = X AND (last_processed_event_ts IS NULL OR last_processed_event_ts != eventTs)`.

### Fix stuck conversation
Reset conversation a33cbcce from `escalated_pending` back to `escalated` so the next reply attempt works with the fixed code. This requires a one-line SQL migration:
```sql
UPDATE conversation_mappings SET status = 'escalated', last_processed_event_ts = NULL WHERE id = 'a33cbcce-5a35-417a-bafd-a2ab32734f07';
```

### Files to change
- `supabase/functions/slack-events/index.ts` — fix the `.or()` filter
- Database migration — reset stuck conversation
- `src/pages/FlowDiagram.tsx` — document the dedup fix

