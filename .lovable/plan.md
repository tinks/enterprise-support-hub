

## Fix conversation 1075c6ca test flag

### Clarification
The database already has fully separate columns for test (`is_test`) and resolve (`status` + `resolved_at`) on `gmail_conversations`. They are not shared. The problem is that conversation `1075c6ca` was incorrectly flagged as `is_test: true`, which excluded it from the default "Live" stats view — making it look like the resolve was not counted.

### Data fix
```sql
UPDATE gmail_conversations
SET is_test = false
WHERE id = '1075c6ca-6295-4f66-b2db-51cdc20a738e';
```

After this, the conversation will appear in the "Live" environment filter on Stats and its resolved status will count toward the Gmail resolved total.

### No schema changes needed
The current schema already separates test and resolve concerns properly:
- `is_test` — whether the conversation is a test
- `status` — 'open' or 'resolved'
- `resolved_at` — timestamp of resolution

### Files to change
- Database data update only (via insert tool) — set `is_test = false`

