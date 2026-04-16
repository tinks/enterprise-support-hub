

## Automate hourly Intercom inbox polling with no-gap guarantee

### Problem
The `poll-intercom-inbox` function is only triggered manually from the Settings page and uses a hardcoded 48-hour lookback window. There's no cron job, so conversations arriving via `support@lovable.dev` to the enterprise inbox can be missed between manual polls. The `last_polled_intercom_at` timestamp is stored but not used as the search boundary.

### Changes

**1. Edit `supabase/functions/poll-intercom-inbox/index.ts` — use `last_polled_intercom_at` as lower bound**
- Replace the hardcoded `48 * 60 * 60 * 1000` window with `last_polled_intercom_at` from settings
- Fall back to 48 hours if `last_polled_intercom_at` is null (first run)
- This ensures every poll picks up exactly where the last one left off — no gaps

**2. Set up an hourly `pg_cron` job**
- Enable `pg_cron` and `pg_net` extensions
- Schedule `net.http_post` to invoke `poll-intercom-inbox` every hour
- Uses the Supabase anon key for authentication

**3. Update Flow diagram**
- Add a note to the Intercom polling node indicating the hourly cron schedule and gap-free `since` logic

### Technical detail
- The `sinceTs` calculation changes from:
  ```
  const sinceTs = Math.floor((Date.now() - 48 * 60 * 60 * 1000) / 1000);
  ```
  to:
  ```
  const sinceTs = settings.last_polled_intercom_at
    ? Math.floor(new Date(settings.last_polled_intercom_at).getTime() / 1000)
    : Math.floor((Date.now() - 48 * 60 * 60 * 1000) / 1000);
  ```
- The cron runs every hour (`0 * * * *`), invoking the edge function via `net.http_post`
- Manual polling from the Settings page continues to work as before
- Deduplication is already handled (checks all three tables before importing)

### Files
- **Edit**: `supabase/functions/poll-intercom-inbox/index.ts` — use `last_polled_intercom_at` as `sinceTs`
- **Edit**: `src/pages/FlowDiagram.tsx` — update Intercom polling node
- **Insert SQL**: pg_cron job schedule (via insert tool, not migration)

