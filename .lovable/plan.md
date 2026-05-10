# Reverse the fix: count by origin (route_source) everywhere

## New rule

A conversation belongs to the source it **originated from**, regardless of whether it was later mirrored/escalated into another tool. So a Slack ticket escalated to Intercom counts as **Slack** in both Source mix and Source performance.

## Changes

### 1. `src/pages/insights/MonthStatsCards.tsx`
- Revert `computeSlackStats` / `computeGmailStats` back to filtering by `route_source` ("slack" / "gmail").
- Restore the **Escalated to human** row for Slack (count of Slack-origin tickets that have an `intercom_conversation_id` or escalated status).
- Restore the real **Bot success rate** (resolved-without-Intercom / total Slack) — distinct from overall success rate again.

### 2. `src/pages/insights/ReportTab.tsx` — Source mix
- Change `sourceMix` to bucket by `route_source` instead of `display_source`:
  - `slack` = `route_source === "slack"` (includes escalated-to-Intercom)
  - `gmail` = `route_source === "gmail"`
  - `intercom` = `route_source === "manual"` AND `display_source === "intercom"` (Intercom-origin imports)
  - `other` = everything else (manual/other)
- Keep colors and ordering as-is.

### 3. Intercom column in Source performance
- The live Intercom API count covers all Intercom conversations in the inbox, which includes Slack-escalated ones. With the new rule those should be attributed to Slack, so the Intercom column now overstates Intercom-origin volume.
- Two options — recommend **Option A** for simplicity:
  - **A. Leave Intercom column as live-API totals** and add a small footnote: "Intercom totals include Slack-escalated conversations." Simple, no backend change.
  - **B. Subtract the Slack-escalated count** (number of Slack-origin tickets in the month with an `intercom_conversation_id`) from the Intercom `count` column so totals reconcile.
- Going with A unless you prefer B.

### 4. Docs
- Update `.lovable/memory/features/month-stats-cards.md` and `.lovable/project-knowledge.md` to state the new rule: **source = origin (route_source)**, and note the Intercom footnote.

No backend, schema, or edge-function changes.
