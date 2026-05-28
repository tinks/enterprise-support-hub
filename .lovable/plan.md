## Remove low CSAT rating from "Help - NPM secret-build secret"

The 1★ rating in your screenshot belongs to manual conversation `4e54b148-fd73-4897-b699-79b5946da7d8` (contact `mleduc@msfourrager.com`, rated 2026-05-28). The ID you pasted (`0bb0198a-…`) is the Lovable project ID; I'm using the conversation from your current route instead.

### Change

Clear the three CSAT columns on that row so it drops out of "Recent low ratings" and the CSAT aggregates:

```sql
UPDATE manual_conversations
SET csat_rating = NULL, csat_remark = NULL, csat_rated_at = NULL
WHERE id = '4e54b148-fd73-4897-b699-79b5946da7d8';
```

No code, schema, or Intercom changes. Note: the next `refresh-intercom-csat` cron run will re-pull the rating from Intercom if the conversation is linked there — let me know if you also want me to mark it as test / unlink it so it stays gone.
