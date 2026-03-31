

## Backfill To/CC headers and re-poll Gmail

### Problem
All ~existing gmail_conversations rows have `to_emails = NULL` and `cc_emails = NULL` because these columns were added after the data was already ingested. The `poll-gmail` function now captures these headers, but it skips messages that already exist (duplicate key check on `gmail_message_id`). So existing rows will never get the data unless we backfill.

### Changes

**1. Create a one-time backfill edge function**

**File: `supabase/functions/backfill-gmail-headers/index.ts`**
- Reads all `gmail_conversations` rows where `to_emails IS NULL`
- For each, calls `Gmail API /users/me/messages/{id}?format=metadata` using the stored OAuth tokens
- Extracts `To` and `Cc` headers
- Updates the row with the extracted values
- Processes in batches to avoid rate limits

**2. Update `poll-gmail` insert logic**

The current insert uses `gmail_message_id` as a unique key and skips duplicates (`error.code === "23505"`). This is correct for new messages. No change needed here — the fix is the backfill.

**3. Trigger the backfill**

After deploying, invoke the function once to populate all existing rows. The "Threads by customer" chart will then show real data.

### Technical detail

```text
For each row where to_emails IS NULL:
  1. GET /gmail/v1/users/me/messages/{gmail_message_id}?format=metadata
  2. Extract To, Cc headers
  3. UPDATE gmail_conversations SET to_emails = ?, cc_emails = ? WHERE id = ?
  
Rate limiting: 50ms delay between requests to stay under Gmail API quota
```

### Files to create/edit
- `supabase/functions/backfill-gmail-headers/index.ts` — new one-time backfill function
- No Stats.tsx changes needed — the existing domain extraction logic is correct, it just needs data

### After backfill
- The "Threads by customer" chart will populate with domains like `retal.com.sa`, `sap.com`, etc.
- Can delete the backfill function afterward since `poll-gmail` handles it going forward

