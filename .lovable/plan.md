# Audit & backfill missing April Intercom tickets

## Current state

DB counts of conversations created Apr 1 – Apr 30 (this project's clock, year 2026) with an `intercom_conversation_id`:
- `manual_conversations`: 154
- `gmail_conversations`: 232
- `conversation_mappings` (Slack): 55
- **Total tracked Intercom-linked: 441**

Polling (`poll-intercom-inbox`) only scans by `team_assignee_id = enterprise inbox` plus per-admin assignees in `admin_owner_map`, with a 10-page safety cap per query and a `last_polled_intercom_at` lower bound. Anything routed elsewhere, assigned to an admin not in the map, or dropped due to a poll outage / page cap will never be tracked.

## Goal

Compare the full set of Intercom conversations **created in April** against everything we already track, then import the gaps into `manual_conversations` so they show up in the app and Stats.

## Implementation

### 1. New edge function: `audit-intercom-month`

`supabase/functions/audit-intercom-month/index.ts` (verify_jwt = false, called from authenticated UI).

Inputs: `{ start: "2026-04-01", end: "2026-05-01", dryRun?: boolean, owner?: string }`.

Logic:
1. Auth: require Bearer token, validate with `auth.getClaims` (same pattern as `bulk-import-intercom`).
2. Page through Intercom `POST /conversations/search` with:
   ```
   { operator: "AND", value: [
       { field: "created_at", operator: ">", value: startTs },
       { field: "created_at", operator: "<", value: endTs },
   ]}
   ```
   `pagination: { per_page: 150 }`, follow `pages.next.starting_after` until exhausted. No team/admin filter — we want everything.
3. Collect every `id` into a `Set<string>`.
4. Query existing IDs in one round-trip each:
   - `manual_conversations.intercom_conversation_id IN (...)`
   - `gmail_conversations.intercom_conversation_id IN (...)`
   - `conversation_mappings.intercom_conversation_id IN (...)`
   - `pending_intercom_links.intercom_conversation_id IN (...)`
   Chunk the `IN` lists to 500 ids.
5. Compute `missingIds = intercomIds − tracked`.
6. If `dryRun`, return `{ totalIntercom, tracked: {manual, gmail, slack, pending}, missingCount, sampleMissing: missingIds.slice(0,20) }`.
7. Otherwise, for each missing id: reuse the exact import path from `bulk-import-intercom` (fetch full conversation, paginate parts, strip HTML, compute earliest `created_at`, capture `conversation_rating` into `csat_*`) and insert into `manual_conversations` + `manual_messages`. Owner: the `owner` arg (default null). Source: `"intercom"`. Rate-limit ~5 req/sec (`setTimeout 200ms`).
8. Return `{ totalIntercom, missingBefore, imported, failed, results }`.

To keep it fast and within edge runtime limits, process at most ~300 backfills per invocation; report `remaining` so a follow-up call can drain the rest. We'll likely call it 1–2 times.

### 2. Trigger

Two-step from this chat:
1. Call with `dryRun: true` → see the gap.
2. Call again without `dryRun` → backfill. Repeat until `remaining === 0`.

No UI surface needed — this is a one-off ops action. (If you want a button later, easy to add to Settings.)

### 3. Out of scope

- Not touching `gmail_conversations` / `conversation_mappings`: anything Intercom-side that maps to an existing Gmail/Slack thread is already tracked, and re-linking isn't part of this task.
- Not changing the recurring poller; if drift is a recurring problem we can schedule this audit weekly afterward.
- No schema changes.

## Files

- `supabase/functions/audit-intercom-month/index.ts` (new)
- `supabase/config.toml` (register `verify_jwt = false`)

Reply "go" to run it.
