

## Add dedicated Intercom analytics section to Stats

### Goal
Mirror the existing per-source sections (Slack / Gmail / Manual) with a new **Intercom** section that aggregates only `manual_conversations` rows where `source = 'intercom'`.

### Approach
Reuse the existing `manualRows` data already loaded — split it into two derived arrays in the `useMemo` pipeline:
- `manualOnlyRows` → `source !== 'intercom'`
- `intercomRows` → `source === 'intercom'`

Then render a parallel section using the same KPI card pattern as the Manual section.

### Changes — `src/pages/Stats.tsx`

**1. Derived data (in existing `useMemo`)**
- Add `intercomRows` and `intercomFiltered` (apply same date/test/cancelled filters as other sources).

**2. KPI cards for Intercom** (mirroring Manual section)
- **Total Intercom tickets** — count
- **Resolved** — count + % of total
- **Active / open** — count
- **Avg resolution time** — using `created_at` → `resolved_at`
- **Escalation rate** — `status = 'escalated'` / total
- **Top product area** — most common `product_area`
- **Bug rate** — `is_bug = true` / total

**3. Charts**
- **Volume over time** — line/area chart of Intercom tickets per day (reuse same chart component as Manual)
- **Resolution status breakdown** — bar chart (resolved / active / escalated / awaiting)
- **Product area breakdown** — bar chart

**4. Section placement**
Insert the new section directly after the existing Manual section, with a clear `<h2>Intercom</h2>` header and matching card grid layout.

**5. Respect existing filters**
The Intercom section should still honor:
- Environment toggle (test / prod)
- Date range
- Channel filter (N/A — Intercom has no Slack channel; section just hides if a channel is selected, or ignores the channel filter — matches Manual section behavior)

### What stays unchanged
- Source filter dropdown (already has Intercom from prior work)
- Top-level KPIs (already include Intercom under "All sources")
- PDF export (will automatically include the new section since it captures the chart container)

### Files
- Edit: `src/pages/Stats.tsx`
- Edit: `.lovable/memory/ui/analytics-dashboard.md` — note the new dedicated Intercom section

### Open question
Should the Intercom section be **hidden when the source filter is set to anything other than "all" or "intercom"** (consistent with how Slack/Gmail/Manual sections behave), or always visible?

