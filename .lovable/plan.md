# Monthly report template

A single-page, print/PDF-friendly "Monthly report" that consolidates the highest-signal numbers from Stats and Insights for a given month. Designed to be readable top-to-bottom by an exec in under 2 minutes, with deeper sections below.

## Where it lives

New tab on the Insights page called **Report** (becomes the first tab, since it's the natural landing for a monthly review). Same month selector as today. A "Download PDF" button reuses the existing `jspdf` + `html2canvas` pattern already in `Stats.tsx`.

No new edge functions, no new tables — it composes data already loaded by `useMonthData` plus the saved AI `monthly_insights` row (overall summary + topic buckets).

## Template structure

### 1. Header band

- Month label (e.g. "March 2026")
- Generated-on timestamp
- One-line headline auto-built from the data, e.g. *"412 tickets · ↓8% vs prev month · 4.6★ CSAT · 62% resolved within 24h"*

### 2. Executive summary (4 hero KPIs)

Big-number cards, each with a delta vs previous month:

- **Total tickets** (with prev-month delta)
- **Avg CSAT** (and rated count)
- **Median time to resolve**
- **% resolved this month**

### 3. AI overall summary

The `overall_summary` paragraph from the saved `monthly_insights` row, if present. Falls back to "Generate topics to populate" CTA.

### 4. Volume & mix

Two-column row:

- **Daily volume sparkline** (stacked by source) — reused from TrendsTab
- **Source mix** donut/bar — reused from ChannelsTab (Slack / Gmail / Intercom / Other with %)

### 5. Ticket type breakdown

Compact 6-bucket row (Issue, Configuration, Bug, FR, Question, Unclassified) with counts + % share, plus avg time-to-resolve per bucket. Pulled straight from `TicketTypesTab` logic.

### 6. Top topics (from AI)

Top 5 topic buckets from `monthly_insights.buckets` sorted by ticket count. For each: name, count, 1-line description, top 2 product areas.

### 7. Top accounts

Top 8 accounts (domain / Slack channel) by ticket count, from `CustomersTab` logic. Columns: account, kind badge, tickets, bugs, FRs, CSAT.

### 8. Product areas

Horizontal bar chart of tickets per product area (top 10), reused from existing Insights "By product area" card.

### 9. Owner load

Compact table: owner, total, bug/FR/issue/config/question split, avg CSAT. Sourced from TicketTypesTab owner aggregation.

### 10. Highlights & watch-outs (auto-generated bullets)

Rule-based callouts derived from the same data, e.g.:

- Largest topic bucket and its share
- Account with biggest jump vs prev month
- Product area with worst CSAT (if ≥3 ratings)
- Bug share trending up/down
- Day-of-week peak
- Any owner over X tickets

These are deterministic strings built from existing aggregations — no extra AI call.

## Export

- **Download PDF** button: renders the report container with `html2canvas` and saves via `jsPDF` (same pattern as Stats export).
- Page uses print-friendly spacing so `Ctrl+P` also works cleanly.

## Technical notes

- New file `src/pages/insights/ReportTab.tsx` composing the existing aggregation helpers. Where logic lives in tab files today (e.g. owner aggregation in `TicketTypesTab`), extract small pure helpers into `useMonthData.ts` (or a sibling `aggregations.ts`) so both tabs share them — no duplicated math.
- For prev-month deltas, call `useMonthData` twice (current month + previous month). Both queries are already capped at 5000 rows and indexed by `created_at`.
- Add `<TabsTrigger value="report">Report</TabsTrigger>` first in the list and set `defaultValue="report"` on `Tabs` in `Insights.tsx`.
- No DB/edge changes. No new dependencies.

## Out of scope

- Email delivery / scheduling
- Saving report snapshots to DB
- Multi-month comparison views beyond the single prev-month delta
- Editable report (it's a generated view, not a document)

**default to last month** (typical "monthly review" flow)  Today the Insights page defaults to last month, and I'd keep that — but let me know if you want MTD instead