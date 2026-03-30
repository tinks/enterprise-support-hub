
Current status after your reconnect (from the latest backend state):
- Gmail ingestion is still not landing in the database (`gmail_conversations` has 0 rows).
- The poll function still fails with `401 Credential not found` in recent logs.
- Conversations/Stats UI wiring is already in place for Gmail data.
- The 15-minute cron job exists and is active, but it cannot ingest while credentials fail.

Plan to finish this cleanly

1) Revalidate the Gmail connection binding
- Confirm the linked `EnterpriseSupportDL` grant is fully active and mapped to this project key.
- Confirm required Gmail permission set is present (`gmail.modify`).
- If the credential mapping still fails, force a full fresh authorization for the same mailbox identity (not a reused stale grant).

2) Harden `poll-gmail` diagnostics
- Update `supabase/functions/poll-gmail/index.ts` to add a preflight Gmail profile call before listing messages.
- Return structured error categories so we can distinguish:
  - connector credential resolution failure,
  - scope/permission failure,
  - Gmail API transport failure.
- Keep logs non-sensitive.

3) Verify ingestion end-to-end immediately
- Trigger one manual poll run after reconnection.
- Validate insertions in `public.gmail_conversations` (including your recent test subject if within query window).
- Confirm rows appear in Conversations and Stats when Source = Gmail/All.

4) Persist scheduler setup in codebase
- Add an idempotent migration to manage `poll-gmail-every-15-min` (unschedule existing name, then schedule once).
- This prevents environment drift where cron exists in runtime but is missing from migrations history.

5) Keep architecture docs aligned
- Update `src/pages/FlowDiagram.tsx` only if polling behavior/diagnostics text changes.
- Update knowledge content with the finalized credential failure mode and recovery path.

Technical details
- Function: `supabase/functions/poll-gmail/index.ts`
- Migration: `supabase/migrations/<timestamp>_schedule_poll_gmail.sql`
- Validation table: `public.gmail_conversations`
- Existing UI files already integrated: `src/pages/Conversations.tsx`, `src/pages/Stats.tsx`

Success criteria
- Manual poll returns `ok: true` with `inserted > 0`.
- Your test email appears in Conversations.
- Gmail metrics are visible in Stats.
- 15-minute polling is both active and migration-backed.
