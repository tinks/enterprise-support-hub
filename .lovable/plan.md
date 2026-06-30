
# Analytics v3 — headline KPI tightening

Scope: only the three headline KPI cards at the top of `/analytics-v3`. No sync changes, no schema changes, no new edge functions. All values are already computable from `intercom_tickets_v3`.

## What changes

### 1. "Total tickets" → "Tickets closed in period"

Today the card labels as "Total tickets" and depending on the toggle shows either finalized-only or finalized+open created-in-range. Leadership will misread that as inbound volume.

- Headline number: **Tickets closed in period** — `lifecycle_status='finalized'` with `finalized_at` inside the selected range. Anchored on `finalized_at` (our internal close timestamp set by v3 sync), not `intercom_closed_at`, so the figure is consistent with the gap-scan reconciliation.
- Drop the "Finalized only / Include open" toggle from the headline. "Opened in range" lives in the Active backlog strip, which is the right home for inbound volume.
- Subline: small muted secondary line — "X opened in same window" — so leadership can see both at a glance without conflating them.
- Tooltip on the title: "Tickets finalized (closed) during this date range, anchored on our internal finalized_at. Excludes tickets still in flight. Tickets opened in this window may close in a later period."

### 2. Average CSAT — add response rate

- Keep the average as the headline number.
- Secondary line under it: **"X% response rate (n rated / m closed)"**, computed against the same closed-in-period set used for headline #1. Today the card only shows `n = … rated` with no denominator.
- Tooltip: "CSAT averages can skew toward extremes when response rates are low. Treat anything under ~30% response with caution."

### 3. Median time to resolve — add P90 companion (n ≥ 10 only)

- Keep median as the headline.
- Secondary line: **"P90: Xh Ym"** computed from the same `time_to_resolve_s` array.
- Threshold: only render the P90 line when `n ≥ 10`. Below the threshold, render a muted "P90: insufficient data (n &lt; 10)" line — keeps the card layout stable instead of jumping.
- Tooltip: "Median = the typical ticket. P90 = 90% of tickets resolve at or under this. Watch P90 for enterprise worst-case experience. Hidden when fewer than 10 finalized tickets in range."

## Technical notes

- Single file edit: `src/pages/AnalyticsV3.tsx`.
- New helper `percentile(values, p)` next to the existing `median` helper.
- `stats` memo changes:
  - `inRange` becomes "finalized rows with `finalized_at` in range" (not "created_at in range"). Drop the `includeOpen` branch and the toggle UI.
  - Add `closedDenominator` (= inRange length), reuse `openedInRange` from `activeStats`.
  - Add `p90Close` from the same `closeTimes` array; gate render on `closeTimes.length >= 10`.
- `Kpi` component already supports a `sub` line. Extend it (or pass JSX into `sub`) to render the secondary stat plus tooltip via existing `Tooltip` primitives.
- No DB / edge / migration work.

## Out of scope

- Per-source breakdown (Slack/Gmail/Intercom) — v3 is Intercom-only by design.
- Replacing the Active backlog strip.
- Anything on Analytics or Analytics v2.

## Mandatory housekeeping (per standing rule)

- Update `.lovable/project-knowledge.md` Analytics v3 section with the new KPI definitions.
- Stage the same content as `pending_content` on `knowledge_documents` (id=`project-knowledge`) via `sync-knowledge-pending` so it surfaces for review on `/knowledge`.
- Add a `changelog_entries` row.
- Flow page: no change (no logic flow changed, only KPI labeling).
