
## What I just re-checked

- I retried the Gmail poll endpoint.
- It still fails with: `Gmail list failed [401]: Credential not found`.
- `gmail_conversations` is still empty (`0` rows), so Conversations and Stats have nothing to show.
- The Gmail connection is linked, but the backend gateway still cannot resolve valid credentials for that linked key.
- I also found there is currently no scheduled polling job in migrations, so automatic 15-minute polling is not actually active yet.

## Plan to fix this fully

1. Stabilize the Gmail connection used by the backend
- Unlink the current broken Gmail connection from this project.
- Link a fresh Gmail connection (new auth grant), not a reused stale one.
- Ensure the granted scope includes `gmail.modify` (covers metadata/listing needed by poller).

2. Refresh backend runtime for the Gmail poll function
- Redeploy `poll-gmail` so it picks up the newly linked connection key cleanly.
- Keep current logic intact for now (no behavior changes yet).

3. Verify ingestion end-to-end immediately
- Trigger `poll-gmail` manually once.
- Confirm at least one row is inserted into `gmail_conversations`.
- Confirm the subject you sent (for example `test ignore`) appears in Conversations (Gmail source) and contributes to Stats totals.

4. Add the missing scheduled poll job
- Create a migration that schedules `poll-gmail` every 15 minutes.
- Include safe idempotency in migration (unschedule existing job name first, then schedule) to avoid duplicate cron jobs.

5. Improve observability for future debugging
- Extend `poll-gmail` logging so failures clearly show whether it is:
  - missing project secret,
  - connector unauthorized,
  - Gmail API response issue.
- Keep logs non-sensitive (no token values).

6. Keep docs and flow aligned
- Update the Flow page node details only if behavior/logging text changes.
- Update project knowledge with:
  - the credential failure mode,
  - the required Gmail permission set,
  - the scheduled polling setup.

## Technical details

- Backend function file: `supabase/functions/poll-gmail/index.ts`
- Migration to add scheduler: `supabase/migrations/<new_timestamp>_schedule_poll_gmail.sql`
- Data table validation target: `public.gmail_conversations`
- Existing settings field already available: `settings.gmail_last_polled_at`
- Flow doc sync file (if text changes): `src/pages/FlowDiagram.tsx`

## Success criteria

- Manual poll returns `ok: true` with `inserted > 0`.
- New Gmail message appears in `/conversations` under Gmail rows.
- Stats page Gmail metrics are non-zero.
- Automatic polling runs every 15 minutes without manual triggering.
