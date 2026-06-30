# Fix false "reopened" flags in Inbox v3

Two related changes to `sync-v3-closed` and the v3 schema/UI. Built so (b) ships even if you skip (a).

## b) Stop CSAT / Label edits from flagging a reopen

Today, any `updated_at` bump on a finalized row flips `lifecycle_status` to `reopened_after_finalize`. Intercom bumps `updated_at` for lots of harmless things (CSAT submission, tag edits, custom-attribute edits, admin notes). Switch to authoritative signals.

**New reopen rule** (in `sync-v3-closed` finalized-row branch):

1. Pull the current `statistics.count_reopens` and `state` for the candidate. We already need this — fetch the full conversation only when `updated_at` advanced (same trigger as today, but now we do a GET instead of trusting the search payload).
2. Flag reopen **only if** either:
   - `state !== "closed"` (truly open/snoozed again), or
   - `statistics.count_reopens > stored_reopen_count_at_finalize`
3. Otherwise: update `intercom_updated_at` + `last_synced_at`, leave `lifecycle_status = finalized`, increment a new `silent_update_count` so we can monitor noise.

**Schema:**
- Add `reopen_count_at_finalize INT` to `intercom_tickets_v3`, populated at finalize time from `statistics.count_reopens`.
- Add `silent_update_count INT NOT NULL DEFAULT 0`.
- One-time backfill: set `reopen_count_at_finalize` for existing finalized rows from `raw_payload->'statistics'->>'count_reopens'`.

**Cleanup of existing false flags:** for rows currently `reopened_after_finalize` where `state='closed'` and `(raw_payload->'statistics'->>'count_reopens')::int <= reopen_count_at_finalize`, flip back to `finalized`. (One-shot SQL, runs with the migration.)

## a) Show what nudged `updated_at`

When (b)'s check decides "not a real reopen", capture *why* so we have forensic visibility.

**Schema:**
- Add `last_silent_change JSONB` to `intercom_tickets_v3` — shape `{ at: iso, fields: [..], details: {..} }`.

**Diff logic** (only runs on the silent path, so cost is bounded):
Compare new full GET payload to stored `raw_payload`. Detect changes in a fixed allowlist:
- `csat_rating`, `csat_remark`, `csat_rated_at`
- `tags` (added/removed)
- `custom_attributes` (per-key added/removed/changed — surfaces "Affected Product Area", "Ticket type", "Conversation Label", etc.)
- `admin_assignee_id`
- `statistics.count_conversation_parts` (admin note added)
- `state` transitions (defensive)

Persist `last_silent_change` and increment `silent_update_count`.

**UI (`/inbox-v3` Finalized tab):**
- New small column / hover-card "Last change" showing the change summary (e.g. "CSAT set to 5", "Tag added: Conversation Label/Bug", "Note added") with the timestamp.
- No change to Active tab — those rows aren't finalized.

## Out of scope

- No change to `sync-v3-open` (open rows can't be "reopened").
- No change to v2.
- No retroactive diffing for rows that already silently changed before this lands — `last_silent_change` will populate on the next silent nudge.

## Technical notes

- `sync-v3-closed/index.ts` finalized-row branch (lines ~222–240) gets the new GET-then-decide flow. Time budget is unchanged; the extra GETs only happen for finalized rows whose `updated_at` advanced, which is already rare.
- `sync-v3-closed` finalize path also writes `reopen_count_at_finalize` going forward.
- One migration adds the three columns + grants are unchanged (existing table already has them).
- Update `.lovable/project-knowledge.md` Inbox v3 section, Flow page reopen node, and add a `changelog_entries` row per the standing rule.
- Memory update: revise `mem://features/inbox-v3/sync-logic` to describe the new reopen criteria.
