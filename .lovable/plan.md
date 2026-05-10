## Goal

Keep the existing AI-clustered topic buckets exactly as they are, and layer additional analytical views on top so the monthly Insights page becomes a richer "state of support" report.

## Proposed structure

Convert the Insights page into a **tabbed view** with the existing AI clusters as the default tab, plus new tabs that surface dimensions the current view doesn't show.

```text
Insights  [ Month: April 2026 ▼ ] [ Regenerate ]

┌ Tabs ──────────────────────────────────────────────────────────┐
│  Topics  │  Customers  │  Ticket types  │  Trends  │  Channels │
└────────────────────────────────────────────────────────────────┘
```

### Tab 1 — Topics (unchanged)
Current buckets, summary, and product-area chart. No changes.

### Tab 2 — Customers
Aggregates tickets by customer identity across all sources:
- **Identity key**: Gmail `from_email`, Slack `slack_user_name`, Manual `contact_name`. Intercom (via `conversation_mappings`) joins on `intercom_contact_id` → cached name from Intercom contact lookup (or fall back to `slack_user_name`).
- **Top customers table**: name/email · ticket count · sources used · #bugs · #feature requests · avg CSAT · top product area · top topic bucket.
- **Header KPIs**: total unique customers, % repeat customers (≥2 tickets), single-ticket customers count.
- **Histogram**: distribution of "tickets per customer" (1, 2, 3, 4–5, 6–10, 10+).
- Click row → side drawer with that customer's tickets for the month (linked to ConversationDetail).

### Tab 3 — Ticket types
Cross-cuts by classification metadata already in DB (no AI needed):
- **Stacked bars** of bug vs feature request vs question/other per product area.
- **Counts**: bugs, feature requests, neither — with % of month.
- **Resolution stats**: avg time-to-resolve (resolved_at − created_at) overall and by type.
- **CSAT panel**: avg rating, rating distribution (1–5), count rated vs unrated, lowest-CSAT bucket.
- **Owner load**: tickets per owner, with bug/FR split.

### Tab 4 — Trends (single derived chart)
- **Daily volume line** for the selected month, split by source.
- **Week-over-week delta** vs the previous month (same days).
- **Movers**: product areas / topic buckets that grew or shrank most vs prior month's stored insight (uses `monthly_insights` history — only shown when prior month exists).

### Tab 5 — Channels
- Source mix donut (Intercom / Slack / Gmail / Other).
- Per-source: ticket count, % of total, avg CSAT, % bugs, % feature requests, top 3 product areas.
- (Lightweight — mostly re-pivots data already aggregated for other tabs.)

## How the data is produced

Two-track approach so we don't pay AI cost for things SQL can do:

1. **Deterministic stats (Customers, Ticket types, Trends, Channels)**: computed on the **client** from a single combined fetch of the month's rows from `conversation_mappings`, `gmail_conversations`, `manual_conversations` (+ `manual_messages` for first-message text only if needed). Same dedup rules as the existing edge function (intercom by `intercom_conversation_id`, gmail by `gmail_thread_id`). No new tables, no new edge function, no AI call. Re-derives instantly when the month changes.
2. **Topics tab (existing)**: still served from `monthly_insights` row produced by `analyze-intercom-month`. Unchanged.

This means **Customers / Ticket types / Trends / Channels work for any month immediately**, even months that haven't been "Generated" yet — only the AI cluster tab requires Generate.

## Why tabs (vs. one long page)

- Keeps the current Topics view uncluttered and primary.
- Each tab answers a different stakeholder question (PM vs. CSM vs. eng lead).
- Cheap to add a 6th tab later (e.g. "Escalations", "SLA misses") without redesigning.

## Alternative considered

A single scrollable dashboard with all sections stacked. Rejected because the page is already content-heavy and customer/ticket-type tables can be long; tabs give clean focus and let us deep-link (`/insights?tab=customers`) from elsewhere later.

## Out of scope

- No schema changes.
- No new edge function (the existing one keeps powering Topics).
- No CSV export in this pass (can add later if useful).
- No customer-level AI summaries (deterministic aggregates only).

## Files to change

- `src/pages/Insights.tsx` — wrap current content in `<Tabs>`, add 4 new tab components.
- `src/pages/insights/` (new folder) — `CustomersTab.tsx`, `TicketTypesTab.tsx`, `TrendsTab.tsx`, `ChannelsTab.tsx`, plus a shared `useMonthData.ts` hook that fetches+normalizes the month's rows once and feeds all four tabs.
- `.lovable/project-knowledge.md` + memory index — note the new multi-tab Insights structure.

## Open question

Anything you'd specifically like surfaced that isn't in the five tabs above (e.g. response-time SLAs, first-touch owner, tag/keyword frequency)? If not, I'll proceed with the structure as described.
