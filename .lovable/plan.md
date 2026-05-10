# Expand Insights documentation in project knowledge

The current `.lovable/project-knowledge.md` only covers three Insights slices (Top accounts grouping, Source attribution rule, Ticket types tab). It's missing the page structure, the shared data hook, four of the six tabs, the AI topic generation pipeline, and the PDF export.

## Add one consolidated section: `## Insights page (full)`

Place it just before the existing `## Insights → Ticket types tab` block (around line 609) and merge the three existing Insights subsections into it so all Insights docs live in one place. Net change: rewrite lines ~609–660 plus appended sections into a single coherent block.

### What the new section covers

1. **Route & layout** (`src/pages/Insights.tsx`)
   - `/insights`, month selector (current month + 11 prior), default = previous month.
   - Tabs: **Report · Topics · Customers · Ticket types · Trends · Channels**.
   - Refresh button bumps `reportRefreshKey` to refetch month data; "Generate / Regenerate topics" calls `analyze-intercom-month`.

2. **Shared data hook** (`useMonthData.ts`)
   - Pulls `conversation_mappings`, `gmail_conversations`, `manual_conversations` for the month with `is_test = false`, normalized into a single `NormalizedTicket[]`.
   - Gmail dedupes by `gmail_thread_id` (earliest row wins).
   - Manual rows whose `intercom_conversation_id` already exists in `conversation_mappings` are dropped (avoids double-count of Slack-escalated tickets that were also imported manually).
   - Adds `route_source` (origin: slack/gmail/manual) and `display_source` (intercom/slack/gmail/other) per ticket.
   - Account resolution: `accountFromEmail` maps free-mail domains (`gmail.com`, `outlook.com`, …) to a single `Personal email` aggregate via `PERSONAL_DOMAINS`. Slack manual imports try to extract a channel ID from the `link` URL.

3. **Source attribution rule** (`sourceBucket.ts`)
   - `sourceBucketOf(t)` is the single source of truth used by Source mix and Source performance:
     ```
     route_source === "slack"      → "slack"
     route_source === "gmail"      → "gmail"
     display_source === "intercom" → "intercom"
     else                          → "other"
     ```
   - Slack-escalated tickets stay attributed to Slack — origin wins.
   - Invariant: `Slack + Gmail + Intercom + Other = Total` for the month.

4. **Report tab** (`ReportTab.tsx` + `MonthStatsCards.tsx`)
   - Stats: total tickets (with delta vs prev month), median TTR, resolved %, classification mix (Issue/Configuration/Bug/FR/Question/Unclassified, with `is_bug`/`is_feature_request` as legacy fallback), avg CSAT, peak day-of-week.
   - Source mix donut + Top accounts (Slack channels and Gmail+Intercom domains, top 5 each, `lovable.dev` and `Personal email` aggregate excluded).
   - **Source performance table** — see dedicated subsection below.
   - Highlights bullets, product-area bar chart, owner load table, classification mix.
   - `UncategorizedPanel` lists tickets missing classification/product area for triage.
   - **PDF export**: `jsPDF` + `html2canvas` snapshot of `reportRef`, multi-page A4, filename `insights-{month}.pdf`.
   - **AI narrative**: pulls saved `monthly_insights` row (`source = "all"`, falls back to `source = "intercom"`) for `overall_summary`.

5. **Source performance table** (`MonthStatsCards.tsx`)
   - Single comparison table, rows = metrics, columns = Slack / Gmail / Intercom.
   - **Counts** (Received, Resolved, Open, Escalated to human, Median resolution / time to close, Average resolution, Success rate, Bot success rate) come from the local DB via `data.tickets` bucketed with `sourceBucketOf` — guarantees reconciliation with Total.
   - **Slack-only**: `Escalated to human` (`intercom_conversation_id` set OR status in `escalated`/`escalated_pending`) and `Bot success rate` (resolved without Intercom / total Slack).
   - **Intercom timing rows** (`Median first response`, `Median response time`, `Median handling time`) come from the live Intercom API via `intercom-month-stats` — local data lacks admin-side reply timestamps.
   - Footer: "Counts from local DB (matches Total). Response & handling times live from Intercom API · {n} this month vs {n} previous."
   - Why not Intercom's live count for the Intercom column: it includes Slack-escalated conversations (already under Slack) and conversations not imported locally — would double-count and break the invariant.

6. **Topics tab** (rendered inline in `Insights.tsx` under `value="topics"`)
   - Reads from `monthly_insights` table (`month`, `source`, `buckets`, `overall_summary`, `product_area_summary`, `ticket_count`, `generated_at`).
   - Shown as topic-bucket cards with source breakdown, product area badges, example subjects, click-through to a Sheet listing all tickets in the bucket.
   - "Generate / Regenerate topics" invokes `analyze-intercom-month` edge function (Lovable AI Gateway) to re-cluster tickets and upsert the row.

7. **Customers tab** (`CustomersTab.tsx`)
   - Aggregates by Slack channel and email domain (Gmail + Intercom combined, `lovable.dev` + `Personal email` excluded).
   - Resolves Slack channel names via `list-slack-channels` (conversations.list → conversations.info → connector gateway fallback).
   - Top 5 each with bug/FR counts and CSAT.

8. **Ticket types tab** (`TicketTypesTab.tsx`)
   - Six-bucket classification model (Issue / Configuration / Bug / FR / Question / Unclassified) with legacy `is_bug`/`is_feature_request` fallback.
   - KPI cards, avg time-to-resolve per type, type-mix-by-product-area, owner load.
   - No "Incident" classification — incident.io detection is a Slack-only status helper, not stored on tickets.

9. **Trends tab** (`TrendsTab.tsx`)
   - Multi-month series (volume, median TTR, escalation rate, CSAT) using sequential `useMonthData` calls for prior months.

10. **Channels tab** (`ChannelsTab.tsx`)
    - Slack-channel-only breakdown of volume, classification mix and product area split.

11. **Top accounts grouping** (move existing block here verbatim)
    - Slack column (by channel), Gmail+Intercom column (by sender email domain).
    - `lovable.dev` and `Personal email` aggregate excluded from the email column only — totals/Source mix/CSAT/product areas unaffected.
    - Channel name resolution and 5-row cap with click-to-expand details.

12. **Edge functions**
    - `analyze-intercom-month`: re-clusters month's tickets via Lovable AI, upserts `monthly_insights` row (`source="all"`).
    - `intercom-month-stats`: returns medians of `time_to_admin_reply`, `median_time_to_reply`, `time_to_last_close` (seconds) plus `count` for selected and previous month. Used only by Source performance Intercom timing rows. Auth: `INTERCOM_API_TOKEN`. No DB writes.
    - `audit-intercom-month`: existing audit helper (note its presence; it predates the recent changes).

13. **`monthly_insights` table** (schema reminder)
    - Keyed by (`month`, `source`); `buckets jsonb`, `overall_summary text`, `product_area_summary jsonb`, `ticket_count int`, `generated_at timestamptz`.
    - Old rows used `source="intercom"`; new generations use `source="all"` (covers Slack + Gmail + Intercom + manual).

### Cleanup
- Remove now-duplicated standalone blocks (`## Insights → Ticket types tab`, `## Monthly Report — Top accounts grouping`, `## Insights → Report — Source attribution rule` and its three sub-blocks) since they're folded into the new section.

## File touched
- `.lovable/project-knowledge.md` — single edit replacing the three existing Insights blocks (~lines 609–660 plus the appended section) with the consolidated block above.

No code changes.
