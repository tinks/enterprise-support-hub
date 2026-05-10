---
name: Month Stats Cards
description: Insights Report tab shows a single source-performance comparison table (Slack/Gmail DB-derived, Intercom live API) scoped to the selected month
type: feature
---
The `MonthStatsCards` component on the Insights Report tab renders one comparison table after the Source mix card — rows are metrics, columns are Slack / Gmail / Intercom — all scoped to the currently selected report month. Cells where a metric does not apply to a source render as a muted "—":

- **Slack** (computed in the browser from `MonthData.tickets` where `route_source === "slack"`): Received, Resolved, Open, Escalated to human (counts tickets with linked `intercom_conversation_id` or status escalated/escalated_pending), Success rate, Bot success rate (resolved without Intercom link), Median + Average resolution time.
- **Gmail** (from `MonthData.tickets` where `route_source === "gmail"`, already deduplicated by `gmail_thread_id` upstream): Email total, Gmail resolved, Gmail open, Gmail median + avg resolution.
- **Intercom** (live via edge function `intercom-month-stats`): Median first response time, Median response time, Median time to close, Median handling time. Each card shows a delta chip vs the previous calendar month — red ▲ if metric increased (worse), green ▼ if decreased (better).

The `intercom-month-stats` edge function calls `POST /conversations/search` filtered by `team_assignee_id = settings.intercom_inbox_id` and `created_at` within the month bounds, paginates up to 25 pages / 1000 conversations per month, and reads the per-conversation `statistics` object: `time_to_admin_reply`, `median_time_to_reply`, `time_to_last_close`. Handling time is approximated as `time_to_last_close - time_to_admin_reply` (admin work after first reply). Both current and previous month are computed in parallel.
