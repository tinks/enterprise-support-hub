# Fix daily volume chart totals on Stats

## The problem

On `/stats`, the "Conversation volume" area chart renders four overlapping series (Slack, Gmail, Manual, Intercom). The daily values don't sum to the KPI totals shown above the chart for two reasons I confirmed in the data:

1. **Gmail ↔ Intercom double-counting.** 255 Gmail rows currently carry an `intercom_conversation_id`, meaning the same conversation is counted once in the Gmail series and again in the Intercom series. When `sourceFilter = "all"`, the four areas overlap and the visual "total" overstates real volume.
2. **Gmail thread dedup is order-of-operations sensitive.** `filteredGmailThreads` dedupes by `gmail_thread_id` *after* the date-range filter is applied. If a thread's earliest message is older than the cutoff but a reply lands inside it, the chart attributes the thread to the reply day instead of its true origin day. This shifts daily counts around, especially near the left edge of any range.

Symptoms the user is seeing: daily bars on the chart don't reconcile with the "Total conversations" KPI, and certain days look inflated.

## Fix

### 1. De-duplicate Gmail/Intercom overlap in `mergedVolumeData`

In `src/pages/Stats.tsx`, when building the per-day buckets:

- Compute a `Set<string>` of `intercom_conversation_id` values present in `filteredGmailThreads`.
- In `intercomVolumeDataOverview`, skip any `manual_conversations` row whose `intercom_conversation_id` is in that set (it's already represented by the Gmail series).
- This mirrors how the existing dedup memory ("Gmail thread deduplication") treats threads as the source of truth and keeps the Intercom series additive only for tickets that didn't originate from a tracked email.

### 2. Bucket Gmail threads on their true earliest date

Switch `filteredGmailThreads` to dedupe against the *full* unfiltered `gmailData` set first (keeping the earliest row per `gmail_thread_id`), then apply the date-range filter against that representative row's `received_at || created_at`. This guarantees a thread is bucketed on its origin date and never gets re-attributed because of a later reply.

### 3. Add a "Total" reference line / tooltip row

To make the chart self-checking:

- Add a computed `total = slack + gmail + manual + intercom` field to each `mergedVolumeData` point.
- Render an extra `<Line>` (no fill) on top of the areas in a muted color so the user can visually confirm the daily total.
- Show `Total` as the first row in the chart tooltip.

### 4. Sanity test

After the fix, sum `mergedVolumeData[*].total` for the active range and assert it equals `stats.total + stats.gmailTotal + stats.manualTotal` (with intercom already merged into manual). Log a `console.warn` in dev when they diverge so future regressions are caught early.

## Files touched

- `src/pages/Stats.tsx` — update `filteredGmailThreads`, `intercomVolumeDataOverview`, `mergedVolumeData`, and the chart JSX.
- `.lovable/project-knowledge.md` — note the dedup rule (Gmail thread linked to Intercom = counted once, on the Gmail series).
- `.lovable/memory/logic/gmail-thread-dedup.md` — extend with the Gmail↔Intercom precedence rule.

## Out of scope

- No DB migrations required.
- KPI cards already use the correct deduped counts; only the chart series need adjusting.
- Other charts (hourly activity, heatmap) have the same overlap risk — flagged for a follow-up but not changed here to keep this PR focused.
