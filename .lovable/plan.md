# Update project knowledge with Source mix / Source performance rules

`.lovable/project-knowledge.md` is missing documentation for the recent Insights → Report changes (Source mix bucketing, Source performance table, `intercom-month-stats` edge function, and the shared `sourceBucket` helper).

## Add one new section at the end of the file

````md
## Insights → Report — Source attribution rule

Tickets are bucketed by **origin** in both `Source mix` and `Source performance` (table). A Slack-originated conversation that was later escalated/mirrored into Intercom still counts as **Slack**, not Intercom.

The shared helper `src/pages/insights/sourceBucket.ts` is the single source of truth:

```ts
sourceBucketOf(t):
  route_source === "slack"     → "slack"
  route_source === "gmail"     → "gmail"
  display_source === "intercom" → "intercom"   // manual imports flagged Intercom
  else                          → "other"
```

Both `ReportTab.tsx` (Source mix donut) and `MonthStatsCards.tsx` (Source performance table) use this helper, so the four buckets always sum to `Total tickets` for the month.

### Source performance table (`MonthStatsCards.tsx`)

Single comparison table with rows = metrics, columns = Slack / Gmail / Intercom.

- **Counts** (Received, Resolved, Open, Escalated to human, Median resolution / time to close, Average resolution, Success rate, Bot success rate) come from the **local DB** via `data.tickets`, bucketed with `sourceBucketOf`. This guarantees reconciliation with `Total`.
- **Slack-only rows**: `Escalated to human` (tickets with `intercom_conversation_id` or `status in ('escalated','escalated_pending')`) and `Bot success rate` (resolved without Intercom / total Slack).
- **Intercom timing rows** (`Median first response`, `Median response time`, `Median handling time`) are fetched live from the Intercom API via the `intercom-month-stats` edge function — these can't be computed from local data because we don't store admin-side reply timestamps.
- Footer notes that counts are local and timing is live, with current vs previous month conversation counts from Intercom.

### `intercom-month-stats` edge function

Queries Intercom Conversations Search for the configured enterprise inbox and returns medians of `time_to_admin_reply`, `median_time_to_reply`, and `time_to_last_close` (seconds) plus a `count` for both the selected month and the previous month. Used **only** for timing deltas in the Source performance Intercom column. Auth: `INTERCOM_API_TOKEN` secret. No DB writes.

### Why we don't use Intercom's live count for the Intercom column

Intercom's live conversation count includes Slack-escalated conversations (already counted under Slack by the origin rule) and may include Intercom items that were never imported into `manual_conversations` locally. Using it as the headline count would double-count and break the `Slack + Gmail + Intercom + Other = Total` invariant. The live count is shown only in the footer for context.
````

No code changes — documentation only.
