## Goal
Below the existing Source mix card on the Insights → Report tab, add three KPI sections — **Slack**, **Gmail**, **Intercom** — scoped to the currently selected report month, matching the visual style of the Stats page screenshots.

## Data sources

### Slack (from `conversation_mappings`, scoped to month by `created_at`, excluding `is_test`)
- Received = count
- Resolved = count where `status = 'resolved'`
- Open = count where `status` not in resolved/cancelled
- Escalated to human = count where `status` reflects escalation (matches Stats page logic)
- Success rate = resolved / received
- Bot success rate = resolved without escalation / received
- Median + Average resolution time (`resolved_at - created_at`)

### Gmail (from `gmail_conversations`, deduplicated by `gmail_thread_id`, scoped to month by `received_at`)
- Email total, Gmail resolved, Gmail open
- Gmail median + avg resolution

### Intercom (live API, scoped to month by `created_at`, `team_assignee_id = settings.intercom_inbox_id`)
New edge function `intercom-month-stats` calls `POST /conversations/search` with date filter, paginates, reads each conversation's `statistics` object:
- Median first response time = `statistics.time_to_admin_reply`
- Median response time = `statistics.median_time_to_reply` (or computed from `conversation_parts` deltas if missing)
- Median time to close = `statistics.time_to_last_close`
- Median handling time = sum of admin reply intervals (computed)

For each, also compute the same metric for the **prior calendar month** so the card can show a delta arrow (▲ red / ▼ green) like the screenshot.

## Files

### New
- `supabase/functions/month-stats/index.ts` — accepts `{ month: "YYYY-MM" }`, returns `{ slack, gmail, intercom }`. Computes Slack/Gmail from DB and Intercom live via `INTERCOM_API_TOKEN`. Also returns `previous` for Intercom deltas. Throttled, paginated, hard cap of 1000 conversations per month for safety.
- `src/pages/insights/MonthStatsCards.tsx` — three sections (Slack, Gmail, Intercom) styled like the screenshots: outlined cards, large number, label below, icon on top. Intercom cards include the delta chip.

### Edited
- `src/pages/insights/ReportTab.tsx` — render `<MonthStatsCards month={selectedMonth} />` immediately after the Source mix card.
- `.lovable/project-knowledge.md` and `.lovable/memory/index.md` — add new memory `mem://features/month-stats-cards`.
- `src/pages/FlowDiagram.tsx` — add a node for the new `month-stats` edge function.

## Out of scope
- No persistence — every load fetches fresh (Intercom call is the slow part; small cache via in-memory map keyed by month is acceptable).
- CSAT card stays on Stats page; not duplicated here.
- No editing of existing Stats page.

## Open considerations
- Intercom rate limits: stagger requests (~80ms) and stop at 1000 conversations/month with a warning if exceeded.
- If the selected month is the current one, "previous" = previous calendar month; partial-month bias acknowledged in tooltip.
