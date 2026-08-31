## What each row means

Every month column is anchored on the same rows Analytics v3 uses, so the newest column reproduces the cards you already look at.

- **Total tickets** — opened in the month (`intercom_created_at` inside the month).
- **Closed tickets** — finalized in the month (`finalized_at` inside the month).
- **Resolved %** — closed ÷ total for that month.
- **Avg CSAT** — average rating across closed-in-month tickets, with the rating count shown as `(n=23)`.
- **Average time to resolve** — mean `time_to_resolve_s` of closed-in-month tickets.
- **Median time to resolve** — the 50th percentile of the same set. P90 shown as a small secondary value, since the median row is where the skew shows.
- **Active backlog** — open at the end of that month.
- **Reopened tickets** — reopened during that month.

## Two definitions that change, and why

Your Notion page recorded **active backlog** and **reopened** as "right now" snapshots taken at the time you wrote each report. Those can't be re-derived as snapshots, so the page computes them per month instead:

- Backlog becomes *open at month end*: created on or before the month end and not finalized by then. For the current month this equals "open now", so August still reads 45.
- Reopened becomes *reopened during the month*, keyed on `last_reopened_at`, rather than the count of tickets sitting in a reopened state today.

Both are better numbers — they're comparable across months instead of being a photograph of one moment. But the recomputed June and July values may not match the 22/31 and 1/5 you wrote down. I'll show the recomputed history and you can compare it against the Notion page before trusting it. Until you've done that, treat the pre-August backlog and reopened columns as UNVERIFIED.

Your own note on the reopened row still stands — a customer replying "Thanks" after close counts as a reopen. That's a separate problem in the reopen classifier, not something this report fixes. The row will carry your note.

## Notes

Each metric row has one Notes cell, editable inline and saved to the database, so next month's report opens with last month's commentary already there. Notes are versionless free text, attributed to whoever last edited them, and are gated behind the same editor role as every other write path in the Hub.
