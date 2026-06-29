# Inbox v3 — Active visibility

Two additive changes. No edits to sync functions, no schema changes, no v2 changes. Both views read `intercom_tickets_v3` as-is.

## 1. `/inbox-v3` — add Active tab

Wrap the current page in a `Tabs` component:

- **Finalized** (default) — existing table, unchanged. Lifecycle filter dropdown becomes Finalized / Reopened / All.
- **Active** — new view. Hardcoded filter `lifecycle_status IN ('open','reopened_after_finalize')`. Reduced column set since open rows don't carry product_area / classification / tags / CSAT / resolve:
  - Intercom ID, Subject, Contact, Owner, State (open/snoozed), Lifecycle badge (open vs reopened), Opened (`intercom_created_at`), Last updated (`intercom_updated_at`), Age (now − created).
  - Sort default: oldest open first (surfaces stale backlog).
  - Sticky banner at top: "Open tickets show search-payload fields only. Product area, classification, tags, and CSAT are populated at close."
- Detail drawer: reuse existing, hide the fields that are null-by-design for active rows.

Owner / search filters apply in both tabs. Lifecycle dropdown only renders in Finalized tab.

## 2. `/analytics-v3` — add Opened vs Finalized chart

New section below existing KPIs, above the footer note:

- **Active KPI strip** (4 small cards): Open now, Reopened (not re-finalized), Oldest open age (days), Opened in selected range. All computed client-side from the same `intercom_tickets_v3` fetch.
- **Opened vs Finalized over time** — daily line chart (recharts, matches existing chart styling).
  - X: day, clamped to `max(CLEAN_DATA_START, fromDate)` → `toDate`.
  - Series A "Opened" = count by `intercom_created_at::date`.
  - Series B "Finalized" = count by `finalized_at::date`.
  - Tooltip shows both counts + running delta (backlog change).
  - Honors the existing date range picker. No new filters.

Both series are computed from a single query that pulls `intercom_created_at, finalized_at, lifecycle_status, reopen_count` for rows where `intercom_created_at >= fromDate` OR `finalized_at >= fromDate` (covers tickets opened-before-range-finalized-in-range and vice versa).

## Files

- `src/pages/InboxV3.tsx` — split table into Finalized + Active tabs. Extract row → small subcomponent to keep the file readable.
- `src/pages/AnalyticsV3.tsx` — add Active KPI strip + Opened-vs-Finalized chart section.
- `.lovable/project-knowledge.md` — append note under Inbox v3 section: "Active tab on /inbox-v3 surfaces non-finalized rows with reduced columns; Opened-vs-Finalized chart on /analytics-v3 tracks backlog trend."
- `.lovable/mem/features/inbox-v3/overview.md` — same note.
- `changelog_entries` — one row: "Inbox v3: Active tickets tab + Opened-vs-Finalized chart".

## Non-goals

- No change to `sync-v3-open` (active view stays cheap, reduced columns).
- No new tables, no new edge functions, no cron changes.
- No engagement/AI columns.
- Flow diagram unchanged (sync architecture didn't change).
