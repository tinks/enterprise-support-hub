---
name: Analytics v2
description: Parallel /analytics-v2 page reading exclusively from inbox_v2_tickets, independent of /stats and /insights
type: feature
---
Phase 1 of a parallel reporting path on top of the Inbox v2 sandbox. Lives at `/analytics-v2` (sidebar: "Analytics v2", Beaker icon). Does not touch `/stats`, `/insights`, `Stats.tsx`, or `useMonthData`.

- Source: `public.inbox_v2_tickets` only. Paginated 1000-row `.range()` fetch filtered by `intercom_created_at` between the selected range.
- Controls:
  - Date range preset: Last 7 / 14 / 30 days (default 30d), This month, Last month, Custom (From/To date pickers).
  - Engagement toggle: `Engaged only` (default) / `All tickets`. Uses shared `effectiveEngagement()` from `src/pages/inbox-v2/engagement.ts` (override → AI guess → tag → default).
  - Refresh button.
- KPIs:
  1. **Total tickets** — row count after engagement filter.
  2. **Average CSAT** — mean of `csat_rating` where not null, plus `n = X rated` subcount.
  3. **Median time to resolve** — median of `raw_payload.statistics.time_to_last_close` (seconds) over rows where `status = 'closed'`. Same field as `intercom-month-stats`. Subcount `n = X closed`.

Engagement helpers were extracted from `InboxV2.tsx` into `src/pages/inbox-v2/engagement.ts` so both pages share one definition. `InboxV2.tsx` imports them from there.

Future phases (not yet built): breakdowns by owner / product area / classification / tags, trend chart, and an `/insights-v2` page. Scope deliberately narrow until Phase 1 is in use.
