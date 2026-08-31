# Trend report (v3)

A month-over-month view that mirrors the Aug 2026 Notion page exactly: metrics down the left, one column per month, and a Notes column you own.

I read the Notion page directly, so the layout below is the real one, not a guess:

- Rows: Total tickets, Closed tickets, Resolved %, Avg CSAT (with n), Average time to resolve, Median time to resolve, Active backlog, Reopened tickets
- Columns: Metric, then one column per month (oldest to newest), then Notes
- Notes are per metric, not per month — e.g. the CSAT row carries "sample size is small relative to ticket volume; treat month-over-month movement as low-confidence"

Where it lives: **Reports → Trend report (v3)** in the sidebar, at `/trend-report`. Default window is 6 months, adjustable from 3 to 12. The June 1, 2026 data floor still applies, so months before it are never shown.

The point of this page is to replace the manual re-keying of numbers into Notion each month. It reads the same `intercom_tickets_v3` rows Analytics v3 reads, so a month column here and the Analytics v3 cards for that month agree by construction.
