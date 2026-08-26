## Staged change

**Step 1 — measure before restructuring (no behavior change).**
Wrap each outbound call in the handler with a timing log (`intercom_fetch_ms`, `slack_post_ms`, `gmail_match_ms`, total handler ms) and log the branch that handled the event. Give every outbound `fetch` an `AbortSignal.timeout` (Intercom 8s, Slack 5s) so a hung upstream fails fast instead of holding the response until the platform kills it. Read one day of logs to see which branch and which call actually produce the 504s.

This alone removes most 504s, because a timeout returns a handled 200 rather than an open socket.

**Step 2 — early acknowledge, background the work.**
Restructure the handler as:

- Parse and verify the signature. Reject bad signatures with 401 as today.
- Do the cheap synchronous guards only: bot-identity check, enterprise-inbox check, and the existing dedup claim (`FOR UPDATE`). These must stay in-request so a retried duplicate is still rejected deterministically.
- `return new Response(ok, 200)` and hand the rest to `EdgeRuntime.waitUntil(handleEvent(payload))` — the Intercom fetch, Gmail email/subject matching, cross-thread link guard, Slack posts, and all downstream writes move unchanged into `handleEvent`.

The ~40 existing early returns inside those later stages become plain `return` statements in `handleEvent`; their messages become structured log lines so the branch taken is still observable.

**Step 3 — replace the retry safety net.**
Because Intercom no longer retries on failure, add a `intercom_webhook_failures` row (event id, topic, payload, error, created_at) written whenever `handleEvent` throws, plus a `:shield:` Slack alert to `#enterprise-support-hub-alerts` reusing the existing `postGuardAlert` helper. A small replay action re-runs one stored payload through `handleEvent`.

Step 3 ships in the same change as step 2 — an early 200 without a dead-letter row is strictly worse than today.

## Risks and boundaries

- Signature verification, the bot-identity guard, and the dedup claim stay synchronous; nothing that decides *whether* to process moves to the background.
- Gmail linking, the cross-thread link guard, and `pending_intercom_links` logic are moved verbatim, not rewritten.
- 503s from cold-boot/CPU pressure improve only indirectly (shorter request lifetimes, fewer concurrent instances). If they persist after step 2, that is a separate capacity question, not a code fix.
- No schema change except the new `intercom_webhook_failures` table (with GRANTs and RLS).

## Verification

- Step 1: one day of logs showing per-call durations and which call exceeds budget; state the measured numbers rather than asserting improvement.
- Step 2/3: replay a captured payload of each topic (new conversation, reply, close, assignment) through the deployed function and confirm the same rows and Slack posts as before; confirm a forced failure lands in `intercom_webhook_failures` and alerts.
- Report the 503/504/520 count for the following 24h window against the current baseline (19 failures) — until that window passes, the fix is UNVERIFIED.

## Docs

Per convention: `.lovable/project-knowledge.md` via `sync-knowledge-pending` (pending, not live), a `changelog_entries` row, and a FlowDiagram node describing the ack-early + dead-letter design.
