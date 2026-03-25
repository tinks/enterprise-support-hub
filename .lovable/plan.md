

## Backfill `resolved_at` for Historical Conversations

### Approach

For all conversations where `status = 'resolved'` and `resolved_at IS NULL`, set `resolved_at = updated_at`. The `updated_at` timestamp on resolved conversations closely approximates when the resolution happened, since the status change to "resolved" is typically the last update made to that row.

This is not perfectly precise — if any row was updated after resolution for an unrelated reason, the timestamp would be slightly off — but it's the best available proxy.

### Change

**One data migration (via insert tool):**

```sql
UPDATE conversation_mappings
SET resolved_at = updated_at
WHERE status = 'resolved'
  AND resolved_at IS NULL;
```

### What this gives you

- All historical resolved conversations immediately appear in the resolution time charts on the Stats page
- Going forward, the edge functions already set `resolved_at` precisely at resolution time
- No schema changes, no code changes — just a one-time data backfill

