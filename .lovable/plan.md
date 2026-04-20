

## Always track Team Inbox Enterprise tickets going forward

### Current state
- Real-time: `intercom-webhook` already imports on assignment to enterprise inbox ✅
- Scheduled: `poll-intercom-inbox` exists but is **not on a cron** — only runs when triggered manually from the Settings page

### Gap
No automatic schedule. If the webhook misses an event (subscription gap, transient failure, ticket created without assignment topic), nothing catches up unless someone clicks the button.

### Plan

**1. Schedule `poll-intercom-inbox` via pg_cron**
Run every 5 minutes. Uses the existing `last_polled_intercom_at` cursor so it only fetches conversations updated since the last run — cheap and idempotent.

```sql
select cron.schedule(
  'poll-intercom-inbox-every-5min',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://dzwcgqyznzrntkbobejo.supabase.co/functions/v1/poll-intercom-inbox',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <ANON_KEY>"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
```

**2. Enable `pg_cron` + `pg_net` extensions** (if not already on).

**3. Show schedule status on Settings page**
Small read-only line under the existing "Poll Intercom inbox" button: "Auto-runs every 5 minutes — last run: {last_polled_intercom_at}". Lets the user confirm it's alive without leaving the app.

**4. Update Flow diagram**
Add a note on the poll node: "Runs automatically every 5 minutes via pg_cron".

### Why this approach
- The poller already has the strict enterprise-inbox guard, dedup checks, Gmail linking, and owner resolution. No new logic needed.
- 5-minute cadence is a good balance: low API cost (one search per admin + team), short enough that missed webhooks are caught quickly.
- pg_cron is the standard scheduling mechanism in this stack.

### Files
- New migration: schedule cron job (run via insert tool, not migration tool, since it contains the project URL + anon key)
- Edit: `src/pages/Index.tsx` — display last-poll timestamp + "auto every 5 min" label
- Edit: `src/pages/FlowDiagram.tsx` — annotate poll node

### Open question
Is **5 minutes** the right cadence, or do you want something different (1 min for near-real-time, 15 min to minimize API calls)?

