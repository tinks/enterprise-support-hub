
## Goal

Stand up a parallel reporting path that reads exclusively from `inbox_v2_tickets`, without touching the existing `/stats` or `/insights` code. Phase 1 ships a single page with three numbers; later phases layer on more.

## Phase 1 scope (this plan)

New route **`/analytics-v2`** (sidebar entry "Analytics v2", Beaker icon, sits next to "Inbox v2"). The page renders:

1. **Total tickets** — count of `inbox_v2_tickets` in the selected window.
2. **Average CSAT** — mean of `csat_rating` where not null, plus an `n =` subcount so a 1-rating month doesn't look like the headline.
3. **Median time to resolve** — median of `raw_payload.statistics.time_to_last_close` (seconds), formatted as `Xh Ym` / `Xd Yh`. Same field the existing `intercom-month-stats` function uses, so the methodology matches.

### Controls

- **Date range picker** — same preset shape as the Inbox v2 export popover (Last 7 / 14 / 30 days, This month, Last month, Custom). Defaults to "Last 30 days". Filter is applied on `intercom_created_at`.
- **Engagement toggle** — segmented `Engaged only` (default) / `All tickets`. "Engaged only" uses the same `effectiveEngagement()` priority chain already defined in `InboxV2.tsx` (override → AI guess → tag → default), keeping one source of truth.
- **Refresh** button.

### What is NOT in Phase 1

- No breakdowns by owner / product area / classification / tag.
- No trend chart, no comparison-to-prior-period chip.
- No `/insights-v2`. That comes in a later phase once you've used Phase 1 and decided which insights cards are worth porting.
- No edits to `/stats`, `/insights`, `Stats.tsx`, `MonthStatsCards.tsx`, or the existing `useMonthData` hook.

## Technical details

- New files:
  - `src/pages/AnalyticsV2.tsx` — page shell, date range + engagement controls, three KPI cards.
  - `src/pages/analytics-v2/useInboxV2Stats.ts` — fetches `inbox_v2_tickets` rows in the selected window (paginated 1000-row `.range()` batches like the v2 export), filters by engagement client-side using the existing `effectiveEngagement` helper, computes the three KPIs.
- Shared helper: extract `effectiveEngagement` / `hasNoEngagementTag` / `NO_ENGAGEMENT_TAGS` from `InboxV2.tsx` into `src/pages/inbox-v2/engagement.ts` so both pages import the same logic. `InboxV2.tsx` keeps using it via re-export — no behavior change.
- Median resolve time reads `raw_payload?.statistics?.time_to_last_close` (seconds). Rows where it's missing or status isn't `closed` are excluded from the median; the card shows `n =` so you can see how many rows contributed.
- Sidebar: add an entry in `AppSidebar` / wherever the Inbox v2 entry lives, route `/analytics-v2`, Beaker icon, label "Analytics v2". Wrap the route in the existing `ProtectedRoute` in `App.tsx`.
- Docs: update `.lovable/project-knowledge.md`, add `mem://features/inbox-v2/analytics-v2` memory, append a `changelog_entries` row. No Flow diagram changes (no logic rewiring).

## Open follow-ups for later phases (not built now)

- Phase 2 candidate: breakdowns (owner / product area / classification / tags) + trend-over-time chart.
- Phase 3 candidate: `/insights-v2` rebuild of the Report / Customers / Channels tabs, scoped to what `inbox_v2_tickets` can actually express (no bug/FR flags, no Slack/Gmail split — those don't exist in the v2 source).
