## Remove the April 1★ CSAT about credits

Found the ticket in `manual_conversations`:

- **id**: `02c3ec8c-ca91-48cd-9c03-fd0132fc932d`
- **subject**: "Help - CRAZY AMOUNT OF CREDITS WASTED"
- **rated**: 2026-04-15, 1★, remark "bad not useful not caring"

### Change

Clear the CSAT fields on that single row (keep the ticket itself):

```sql
UPDATE manual_conversations
SET csat_rating = NULL, csat_remark = NULL, csat_rated_at = NULL
WHERE id = '02c3ec8c-ca91-48cd-9c03-fd0132fc932d';
```

Effect: the rating disappears from April CSAT in Stats, Insights, and the new monthly Report. The other April 1★ ("Preview reverting to old version") is left untouched.

### Out of scope

- No code changes
- No schema changes
- The ticket itself stays visible in conversations
