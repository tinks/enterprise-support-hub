
## Scope guardrail

Everything below is **net-new**. No edits to `inbox_v2_tickets`, `sync-inbox-v2`, `InboxV2.tsx`, `AnalyticsV2.tsx`, or any existing cron. v2 keeps running untouched. v3 is a parallel stack the user manually cuts over to later.

## Design premise

Intercom is source of truth. Ticket fields are in flux while open and final at close. v3 is built around that asymmetry:

- **Closed tickets** = the reporting unit. Synced once, frozen, never re-touched (except reopen flag).
- **Open tickets** = cheap freshness only. Search-payload data, no per-ticket GETs.
- **Hard data floor** = `2026-06-01`. Single constant. Nothing before is fetched, stored, or reportable.
- **Resumable by construction.** Every sync invocation is time-boxed (~120s) and advances a persisted cursor.
- **Self-healing.** Daily gap-scan compares Intercom counts to ours by closed-date and re-queues missing days.

Per user answers:
- Drop Engagement / AI classifier in v3. Owner-at-finalize is enough.
- Reopens: flag in `lifecycle_status`, do **not** re-finalize. Increment `reopen_count`, no other action.
- Build a **v3 inbox view** as well, read-only, for data spot-checking.
- Run v2 and v3 in parallel until user manually cuts over.

## What gets built

### 1. New table: `public.intercom_tickets_v3`

One row per Intercom conversation. Reporting-grade columns only — no engagement / AI columns.

| Column | Notes |
|---|---|
| `intercom_conversation_id` (unique) | join key |
| `team_assignee_id`, `admin_assignee_id`, `owner` | enterprise guard + reporting dim |
| `contact_name`, `contact_email`, `contact_domain` | reporting dim |
| `subject` | display |
| `state` (`open` / `closed` / `snoozed`) | Intercom state |
| `lifecycle_status` (`open` / `finalized` / `reopened_after_finalize`) | our state |
| `product_area`, `classification`, `tags text[]` | written on finalize only |
| `csat_rating`, `csat_remark`, `csat_rated_at` | reporting |
| `time_to_first_admin_reply_s`, `time_to_resolve_s` | snapshot at finalize (precomputed; no JSON parsing at query time) |
| `intercom_created_at`, `intercom_updated_at`, `intercom_closed_at` | timeline |
| `finalized_at` | when WE locked it |
| `reopen_count`, `last_reopened_at` | reopen audit |
| `last_synced_at`, `last_full_fetch_at` | bookkeeping |
| `raw_payload` jsonb | finalize snapshot for debug |

Plus `public.intercom_sync_jobs_v3`: `id`, `kind` (`closed_backfill` / `open_refresh` / `gap_scan`), `cursor_ts`, `status`, `processed`, `started_at`, `finished_at`, `last_error`. One active row per kind; the cron resumes it.

Standard grants + RLS: `authenticated` read-only; `service_role` full. No client writes. Trigger for `updated_at`.

### 2. New shared constant

`src/pages/inbox-v3/constants.ts` → `CLEAN_DATA_START = '2026-06-01T00:00:00Z'`. Imported by sync functions (via duplicate constant in `_shared/v3.ts` for Deno) and by the v3 pages.

### 3. Three new edge functions

All net-new files under `supabase/functions/`. None touch v2 code.

**`sync-v3-closed`** — the important one. 15-min cron + manual button.
```
search: team_assignee_id=enterprise AND state=closed
        AND updated_at > greatest(last_seen_closed_at, CLEAN_DATA_START)
        ORDER BY updated_at ASC
```
For each:
- row exists with `lifecycle_status='finalized'` and matching `intercom_closed_at` → skip.
- otherwise → full GET, write all fields, set `lifecycle_status='finalized'`, `finalized_at=now()`, advance cursor.
- finalized row with newer Intercom activity → `lifecycle_status='reopened_after_finalize'`, `reopen_count++`. No re-finalize.

Time-box at 120s, persist cursor, return.

**`sync-v3-open`** — 5-min cron. Cheap freshness.
```
search: team_assignee_id=enterprise AND state=open AND updated_at > now()-2h
```
Upsert from **search payload only** — no per-conversation GET. Writes only: `state`, `admin_assignee_id`, `owner`, `subject`, `contact_*`, `intercom_updated_at`, `last_synced_at`. Deliberately does NOT touch `product_area`, `classification`, `tags`, `statistics`, `csat_*` — those aren't trusted until close.

**`sync-v3-gap-scan`** — daily cron. Safety net.
- Asks Intercom `/conversations/search` for counts of closed conversations bucketed by day, last 30 days, clamped to `CLEAN_DATA_START`.
- Compares to `intercom_tickets_v3` counts by `intercom_closed_at::date`.
- Any day with a discrepancy → enqueues a `closed_backfill` job clamped to that day, which `sync-v3-closed` drains.

This is the mechanism that would have caught the 5 missing tickets automatically.

### 4. New routes

- `/inbox-v3` → `src/pages/InboxV3.tsx`. Read-only table over `intercom_tickets_v3`. Same filter shape as v2 (Owner / Product Area / Classification / Status / Tags / search) but with two v3-specific filters: `lifecycle_status` (Finalized / Open / Reopened) and a default toggle "Finalized only" (on by default). Detail drawer: read-only fields + "View in Intercom". No engagement column, no overrides, no AI buttons.
- `/analytics-v3` → `src/pages/AnalyticsV3.tsx`. Same KPI shape as v2 (Total / CSAT / Median time to resolve) but:
  - reads `intercom_tickets_v3` only,
  - default filter `lifecycle_status='finalized'` with toggle to include open,
  - From date picker clamped to `CLEAN_DATA_START`, footer note "Data from June 1, 2026 onward",
  - Median resolve reads pre-computed `time_to_resolve_s` (no JSON unmarshal),
  - small chip showing `last_seen_closed_at` + active job count so staleness is obvious.

Sidebar: add `Inbox v3` (Beaker) and `Analytics v3` (Beaker) entries in `AppLayout`. v2 entries stay.

### 5. Settings additions

New card: "Inbox v3 sync". Shows job state for each kind (last cursor, processed, status), with two manual buttons:
- **Catch up closed** — invokes `sync-v3-closed` in a loop until cursor is current.
- **Run gap scan now** — invokes `sync-v3-gap-scan`.

### 6. Crons (pg_cron via supabase insert tool, not migration)

- `sync-v3-closed-frequent` — every 15 min
- `sync-v3-open-frequent` — every 5 min
- `sync-v3-gap-scan-nightly` — 04:00 UTC

### 7. Integration health

`sync-v3-closed`, `sync-v3-open`, `sync-v3-gap-scan` each write to `integration_health` (keys `inbox_v3_closed_sync`, `inbox_v3_open_sync`, `inbox_v3_gap_scan`). Surfaced in existing Integration health card.

### 8. Docs

- `.lovable/project-knowledge.md` — new "Inbox v3" section.
- New memory file `mem://features/inbox-v3/overview` referenced from `mem://index.md`.
- `changelog_entries` row.
- Flow page: new "Inbox v3" sync nodes (closed / open / gap-scan).

## Rollout order

1. Migration: `intercom_tickets_v3` + `intercom_sync_jobs_v3` + grants + RLS + trigger.
2. Ship `sync-v3-closed`, `sync-v3-open`, `sync-v3-gap-scan`.
3. Stand up `/inbox-v3` and `/analytics-v3` + sidebar entries.
4. Add Settings v3 card + manual catch-up button.
5. Register crons.
6. Manually drain closed-backfill from June 1 → today.
7. Spot-check the 5 previously-missing tickets in `/inbox-v3`.
8. Diff `/analytics-v3` vs `/` (legacy Analytics) for ~2 weeks. When numbers reconcile, user manually decides to cut over (separate, future task — not part of this plan).

## Explicit non-goals

- No changes to `inbox_v2_tickets`, `sync-inbox-v2`, v2 page, v2 analytics, v2 crons, v2 engagement / AI logic.
- No automatic cutover. v2 and v3 coexist indefinitely until the user says otherwise.
- No engagement classification in v3. No AI columns.
- No reopen re-finalize pipeline. Reopens are flagged only.
- No retroactive prune of older data — `CLEAN_DATA_START` is enforced on read/write going forward; v3 simply never holds pre-June-2026 rows.
