# v3 owner dashboards (parallel)

Today `/my/:owner` renders `Conversations.tsx` over the three legacy tables (`conversation_mappings`, `gmail_conversations`, `manual_conversations`). It never reads `intercom_tickets_v3`.

This adds a **parallel** read-only dashboard at `/my-v3/:owner` built on `intercom_tickets_v3`, using the same shared v3 issue components as Triage, Inbox v3 and Escalations. Nothing on `/my/:owner` changes; cutover stays manual.

## What the v3 dashboard shows

Owner filter is `intercom_tickets_v3.owner` (case-insensitive match on the route param), clamped to the June 1, 2026 data floor.

- **Active** (default tab) — `lifecycle_status IN ('open','reopened_after_finalize')`, oldest-first, age >14d highlighted, `transferred_out` excluded.
- **Closed** (second tab) — `lifecycle_status = 'finalized'`, newest-first, with product area, classification, tags, CSAT and resolve time.
- Single scrolling table per tab (no pager), matching the load-everything behaviour you asked for on the legacy dashboards.
- Row click opens the existing read-only `IssueDetailSheet`. No inline edits, no write-through.

## Coverage difference — read this before cutting over

The v3 set is Intercom enterprise tickets only. Slack threads and Gmail threads that never became an Intercom conversation, plus manual-only logs, exist on the legacy dashboard and will **not** appear here. Current owner distribution in v3: Tine 207, Matt 174, Eren 114, Tejas 41, Sam 19, Kristina 5, unassigned 27 (587 rows total, 15 of them `transferred_out`). The two dashboards are expected to disagree; the v3 one is the reporting-grade subset.
