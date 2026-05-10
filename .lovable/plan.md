# Fix Source mix vs Source performance discrepancy

## Root cause

Both views look at the same ticket pool but bucket differently:

- **Source mix** (`ReportTab.tsx`) groups by `display_source` — a Slack ticket that escalated to Intercom is counted under **Intercom**.
- **Source performance** (`MonthStatsCards.tsx`) groups by `route_source` — that same escalated ticket is still counted under **Slack** because it originated there.

So Source mix shows Slack = 36 (only tickets resolved by the bot inside Slack), while Source performance shows Slack = 85 (every ticket that entered via Slack, including ~49 that were escalated and live in Intercom now).

## Fix

Make Source performance match Source mix's definition of "source" so the same number appears in both places.

In `src/pages/insights/MonthStatsCards.tsx`:

1. Change `computeSlackStats` to filter `tickets.filter(t => t.display_source === "slack")` instead of `route_source === "slack"`.
2. Change `computeGmailStats` similarly to `display_source === "gmail"` (no behavioral change today since gmail's display and route are the same, but keeps the rule consistent).
3. Recompute the derived metrics on this narrower set:
   - `Received`, `Resolved`, `Open`, `Success rate`, `Bot success rate`, median/average resolution.
   - `Escalated to human` row becomes meaningless under the new definition (a Slack ticket that escalated is no longer in the Slack bucket). Replace this row with `—` for Slack, OR drop the row. Recommended: **drop the row** to keep the table clean, since the Source mix already implicitly shows the escalation split.
4. No changes to the Intercom column — it stays sourced from the live `intercom-month-stats` edge function.

## Files

- `src/pages/insights/MonthStatsCards.tsx` — swap the filter field and remove the Escalated row.
- `.lovable/memory/features/month-stats-cards.md` — document that Slack/Gmail counts are by `display_source` to align with Source mix.
- `.lovable/project-knowledge.md` — note the alignment rule.

No backend, schema, or data-fetching changes.
