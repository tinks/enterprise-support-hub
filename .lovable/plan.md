

## Add Resolution Time Tracking & Reporting

### Problem
`created_at` marks when a conversation starts, but there's no reliable timestamp for when it's resolved. The `updated_at` column exists but has no trigger and isn't set by edge functions on status changes.

### Changes

**1. Database migration — Add `resolved_at` column**

```sql
ALTER TABLE conversation_mappings ADD COLUMN resolved_at timestamptz;
```

A dedicated column is cleaner than relying on `updated_at` — it captures exactly when resolution happened.

**2. Edge functions — Set `resolved_at` on resolution**

In every place where `status` is set to `"resolved"`, also set `resolved_at: new Date().toISOString()`:

- `supabase/functions/slack-interactions/index.ts` — positive feedback handler (👍 button)
- `supabase/functions/intercom-webhook/index.ts` — conversation/ticket closed handler

Three update calls total, adding one field to each.

**3. `src/pages/Stats.tsx` — Add resolution time metrics**

Compute from resolved conversations where `resolved_at` exists:
- **Median resolution time** — displayed as a summary card (e.g., "2h 15m")
- **Average resolution time** — displayed alongside median
- **Resolution time distribution chart** — a bar chart showing buckets (< 15min, 15min–1h, 1–4h, 4–24h, 24h+)
- Resolution time trend line (rolling 7-day average)

Only conversations with both `created_at` and `resolved_at` are included. Historical conversations without `resolved_at` are excluded from time metrics (not backfillable).

### Summary
- 1 migration (1 new column)
- 2 edge functions updated (~3 lines each)
- 1 UI file updated (new stats cards + chart)
- No impact on existing data — new column is nullable

