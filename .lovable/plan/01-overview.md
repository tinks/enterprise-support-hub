# Open work and recommended order

## What is actually open

Roadmap.md is stale in one place: the multi-Linear escalations item (option B) shipped yesterday, including the 10-test union suite. Treating that as closed, six things remain.

**1. Publish blockers (3 critical scanner findings)**
- `gmail_oauth_hijack` — gate `gmail-auth-url` behind `requireEditor`; server-stored single-use `state` nonce verified in `gmail-oauth-callback`; definer RPC for the `Index.tsx` connected indicator.
- `open_data_read_fns` — `requireUser` on list-slack-users, list-slack-channels, fetch-thread-messages, fetch-gmail-thread, intercom-month-stats, check-bot-identity (search-intercom-by-email already done). All UI-invoked.
- `open_mutation_fns` — caller inventory first. UI-invoked → `requireEditor`; cron/webhook (poll-*, sync-v3-*, reconcile-v3-open, context-reminder, integration-health-alert, publish-registry-notion) → shared-secret header or existing signature verification. Blanket-applying breaks them silently as stale data.
- Then re-run the scan and publish.

**2. Display pass for the four-way resolution clock** — the engine persists it, no surface reads it yet: Analytics v3 sub-line, trend report tooltip, resolution anatomy switched from client derivation to the persisted columns, escalations board showing `eng_wait_start_at` / `eng_wait_end_at`. Plus a doc pass.

**3. DB performance items 4–5** — snapshot-served coverage metrics, and the composite index on sync-job status (item 6 is your migration).

**4. Watch item** — `eng_wait_source` fallbacks `dev_escalation_row` and `linear_created` remain UNVERIFIED; all 30 live rows took `attribute_event`.

**5. Security batches 4 and 5** — deliberately unstarted.
