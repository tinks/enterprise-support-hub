## Step 1 — Gmail OAuth hijack

1. Gate `gmail-auth-url` behind `requireEditor`.
2. New table `gmail_oauth_states` (`state` primary key, `created_at`, `consumed_at`, `created_by`). `gmail-auth-url` inserts a random single-use `state` and puts it in the consent URL. Migration is yours to run; I write the SQL.
3. `gmail-oauth-callback` looks the `state` up **before** anything else, and refuses when it is absent, unknown, already consumed, or older than 10 minutes — returning the error page without touching `gmail_oauth_tokens`. Only after the token exchange succeeds does it mark the state consumed and do the delete-then-insert.
4. `Index.tsx` reads connection status through a security-definer RPC (`gmail_connection_status()`) returning only `{ connected, email_address }` — never the token row.

**Verification.** A full real OAuth round-trip through the UI proves the happy path. Then the negative tests, run explicitly and reported: callback with no `state`, with a made-up `state`, and with a replayed `state` from a completed flow — each must be rejected and the existing token row must still be intact afterwards.

## Step 2 — Re-verify the data-read functions

No code expected. Exercise each of the six from the UI signed in (Slack pickers, thread views, Gmail thread pane, month stats, bot identity card) and confirm each still returns data, plus one unauthenticated `curl` per function confirming 401. If the scanner still flags one after that, it is pointing at a function not on the roadmap list — I will name it rather than guess.

## Step 3 — Mutation functions, inventory first

Nothing gets edited until the inventory exists. For each of the 35 ungated functions I record: real UI call sites (`supabase.functions.invoke`, not just a name string), cron entries from the scheduled-jobs table, and webhook callers. Grep already shows this is mixed — `poll-gmail`, `sync-v3-*`, `publish-registry-notion`, `reconcile-v3-open`, `sync-intercom-fields` all have both a "Run now" button and a schedule, so they land in the dual-caller bucket.

Then, in caller order:

- **UI-only** (one-off backfills, imports, cleanups) → `requireEditor`. Lowest risk, done first.
- **Dual-caller** → a new `_shared/require-editor-or-secret.ts`: accept a valid editor session, else a `x-esh-cron-secret` header matching a stored secret; reject otherwise. Cron entries updated to send the header in the same change, so the schedule never runs a window without it.
- **Webhook-only** (`slack-events`, `slack-interactions`, `intercom-webhook`) → confirm the existing signature verification is unconditional and runs before any write. If it already is, they are gated; I say so rather than adding a second gate.

**Verification per function, not per batch.** For each one: invoke from its real caller and confirm it still works, then call it unauthenticated and confirm 401/403. For cron functions, confirm the next scheduled run recorded a healthy row in integration health — a green deploy is not evidence the schedule survived.

## Step 4 — Re-scan, then publish

Re-run the security scan, report what remains, and publish only once the three critical findings clear.

## Boundaries

- Security batches 4 and 5 stay untouched.
- No change to any function's business logic; gates only, plus the OAuth state table.
- The three findings ship as three separate passes so a regression is attributable.
- Doc pass at the end: project-knowledge via `sync-knowledge-pending` (pending, not live), a `changelog_entries` row, and a FlowDiagram node for the OAuth state check and the dual-caller gate.
