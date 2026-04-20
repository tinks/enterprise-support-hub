

## Fix: legacy Intercom imports labeled as "manual entry"

### Problem
The user reports imported Intercom tickets show as "Manual entry" instead of "Intercom". My recent filter work assumed all Intercom-imported rows have `source = 'intercom'` in `manual_conversations`. But legacy rows likely have `source = 'manual'` (or `'other'`) with a populated `intercom_conversation_id` — those are real Intercom imports that never got the correct source tag.

### Investigation needed (will run after approval)
Quick query to confirm:
```sql
SELECT source, COUNT(*), COUNT(intercom_conversation_id) AS with_ic_id
FROM manual_conversations
GROUP BY source;
```

### Fix

**1. Data backfill (one-time SQL via insert tool)**
Update any `manual_conversations` row that has a non-null `intercom_conversation_id` to `source = 'intercom'`:
```sql
UPDATE manual_conversations
SET source = 'intercom'
WHERE intercom_conversation_id IS NOT NULL
  AND source <> 'intercom';
```

**2. Audit the import paths to ensure new rows always set `source = 'intercom'`**
Verify these write `source: 'intercom'`:
- `supabase/functions/import-intercom-ticket/index.ts` ✅ (already does)
- `supabase/functions/bulk-import-intercom/index.ts` ✅ (already does)
- `supabase/functions/backfill-enterprise-inbox/index.ts` — verify
- `supabase/functions/poll-intercom-inbox/index.ts` — verify
- `supabase/functions/intercom-webhook/index.ts` (assignment auto-import) — verify

If any path inserts with a different source, patch it to use `'intercom'`.

**3. No UI changes needed**
The Inbox already shows "Intercom import" badge for `source === 'intercom'`, and the new "Intercom" filter (just shipped) will pick these up correctly once the data is fixed.

### Files
- Run UPDATE via insert tool (data fix)
- Possibly edit: `backfill-enterprise-inbox/index.ts`, `poll-intercom-inbox/index.ts`, `intercom-webhook/index.ts` (only if audit finds wrong source)

### Why this approach
- Root cause is data, not UI. Filter is correct; rows are mislabeled.
- `intercom_conversation_id IS NOT NULL` is a reliable signal — only Intercom-linked rows have it populated.
- Auditing import paths prevents the issue from recurring.

