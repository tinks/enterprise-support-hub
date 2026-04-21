---
name: Pending Intercom Links
description: Deferred linking layer that holds Intercom tickets in escrow for up to 20 min so poll-gmail can match them to the source Gmail thread before any duplicate manual_conversations row is created
type: feature
---
Closes the race where `intercom-webhook` fires within seconds of an Intercom ticket being assigned to the enterprise inbox, but `poll-gmail` (which runs every 15 min) hasn't yet inserted the corresponding Gmail row. Without this layer, the webhook fell through to creating a `manual_conversations` stub, then the Gmail row landed minutes later and got stamped with the same `intercom_conversation_id` — producing two rows for the same logical conversation.

### Flow

1. **`intercom-webhook`** (assignment topic): runs all linker tiers (email-based gmail, subject-based gmail, manual-conversations subject lookup). If everything misses, it inserts into `pending_intercom_links` with the full source payload + pre-extracted messages and returns. **No `manual_conversations` row is created at this point.**
2. **`poll-gmail`** (every 15 min): after inserting new Gmail rows, scans `pending_intercom_links` for entries whose `normalized_subject` matches one of the just-inserted threads AND whose `intercom_created_at` is within ±15 min of the Gmail `received_at`. On match, stamps the Gmail thread with `intercom_conversation_id` and deletes the pending row.
3. **`promote-pending-intercom-links`** (every 2 min via pg_cron job `promote-pending-intercom-links-every-2min`): for any pending row older than 20 min, re-runs the Gmail/manual/slack existence check one more time and either late-reconciles or promotes the row into `manual_conversations` exactly the way the old webhook path did. This is the safety net for tickets whose mail never reached our Gmail (Intercom Messenger, non-Group inbound).

### Group alias guard

When the Intercom contact email is `enterprise-support@lovable.dev` (the Google Group alias), the email-based gmail linker is skipped entirely — searching for that string would match every Gmail row in the inbox. The subject-based linker still runs, and unmatched tickets fall into the pending queue. The whitelist lives in a `GROUP_ALIASES` constant inside `intercom-webhook`.

### Schema

`pending_intercom_links` (RLS: deny public, authenticated read only):
- `intercom_conversation_id` (unique) — dedup across webhook retries
- `normalized_subject` — strips `Re:`/`Fwd:`/`Fw:`, collapses whitespace, lowercases
- `intercom_created_at` — used for ±15 min windowing against Gmail `received_at`
- `contact_name`, `contact_email`, `resolved_owner` — preserved for promotion
- `source_payload` (jsonb) — `{ subject, link, intercom_conversation_id, conversation_created_at }`
- `pre_messages` (jsonb) — pre-extracted, sorted; reused by poll-gmail (skipped) and promote-pending (inserted into `manual_messages`)
- `attempts`, `last_attempt_at` — incremented by promote-pending on insert errors so we don't tight-loop a broken row

### Operational notes

- New tickets from Google-Group emails do NOT appear in the inbox until either the matching Gmail row arrives (within 15 min, normal) or 20 min elapses (rare). This is the correct outcome — the alternative was the duplicate.
- The reply path of `intercom-webhook` is unchanged. If a reply arrives before the pending link resolves, the reply handler currently won't find a row to update; the next pass of `promote-pending-intercom-links` will create the row and subsequent replies will sync via `backfill-intercom-replies?recent=true` (5-min cron, 7-day window).
- See `mem://logic/duplicate-intercom-ticket-detection` for the linker tier order and `mem://logic/google-group-linking` for the subject-fallback rationale.
