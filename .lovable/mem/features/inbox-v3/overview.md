---
name: Inbox v3 overview
description: Closed-anchored reporting mirror of Intercom enterprise tickets, parallel to v2. Hard data floor June 1 2026. Three edge functions, three crons, two pages, one sync card.
type: feature
---

# Inbox v3

Reporting-grade mirror of Intercom enterprise tickets. **Parallel** to Inbox v2 — no v2 code, table, or cron is touched. Cutover is manual.

## Design premise

- **Closed = reporting unit.** Synced once on finalize, frozen, never re-touched (except reopen flag).
- **Open = cheap freshness.** Search-payload only, no per-conversation GET.
- **Hard data floor:** `CLEAN_DATA_START_ISO = 2026-06-01T00:00:00Z`. Enforced server-side (sync) and client-side (UI clamps).
- **Resumable + self-healing.** Every sync is time-boxed at ~120 s with a persisted cursor in `intercom_sync_jobs_v3`. Daily gap-scan reconciles Intercom counts vs ours per day and auto-enqueues missing days.

## Tables

- `intercom_tickets_v3` — one row per conversation. Reporting columns only (no engagement / AI). Lifecycle: `open` / `finalized` / `reopened_after_finalize`. Pre-computes `time_to_resolve_s` at finalize so KPIs don't unmarshal jsonb.
- `intercom_sync_jobs_v3` — one row per sync invocation. `kind ∈ closed_backfill | open_refresh | gap_scan`. Latest row per kind drives Settings UI.

## Edge functions

| Function            | Mode                       | What it does                                                                                                                                                                                  |
| ------------------- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sync-v3-closed`    | incremental / backfill     | Walks closed enterprise convs `updated_at > cursor`. Full GET per row, writes everything, sets `lifecycle_status='finalized'`. Existing finalized rows w/ newer activity → `reopened_after_finalize` (no refinalize). |
| `sync-v3-open`      | windowed (default 2 h)     | Search-payload upsert of open enterprise convs. Skips finalized rows. Never touches product_area / classification / tags / csat — those are only trusted at close.                            |
| `sync-v3-gap-scan`  | nightly                    | Bucket last 30 days into UTC days, compare Intercom `total_count` (closed) vs our finalized count per day. Self-invokes `sync-v3-closed` in backfill mode for any shortfall.                   |

## Crons

- `sync-v3-closed-frequent` — every 15 min
- `sync-v3-open-frequent` — every 5 min
- `sync-v3-gap-scan-nightly` — 04:00 UTC daily

## UI

- `/inbox-v3` — read-only, two tabs:
  - **Finalized** — full column set (product area, classification, tags, CSAT, resolve). Lifecycle filter: Finalized / Reopened / All closed-side.
  - **Active** — `lifecycle_status IN (open, reopened_after_finalize)`. Reduced columns (no product area / classification / tags / CSAT / resolve since open rows don't carry them). Sorted oldest-first; age >14d highlighted.
- `/analytics-v3` — KPIs (Total / Avg CSAT / Median resolve) + **Active backlog** strip (Open now, Reopened, Oldest open age, Opened in range) + **Opened vs Finalized over time** daily line chart. Date pickers clamped to data floor.
- Settings → **Inbox v3 sync** card — per-kind job status + manual buttons (Catch up closed, Run closed once, Run open refresh, Run gap scan).

## Constants

`src/pages/inbox-v3/constants.ts` for the UI; duplicated as `CLEAN_DATA_START_ISO/UNIX` in `supabase/functions/_shared/v3.ts` for Deno.

## Non-goals

- No edits to v2 (`inbox_v2_tickets`, `sync-inbox-v2`, `InboxV2.tsx`, `AnalyticsV2.tsx`, v2 crons).
- No engagement classification in v3.
- Reopens are flagged only — never re-finalize.
- No automatic cutover. v2 and v3 coexist until user manually cuts over.
