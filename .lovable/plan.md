## Goal

Make it easy to drill into "Unclassified" tickets for a given month (e.g. April 2026) from Insights → Ticket types.

## Approach

Make the per-bucket KPI cards in the Ticket types tab clickable. Each card deep-links to Conversations filtered to that month and that classification (with `showAll=1` so resolved/cancelled aren't hidden, matching the Owner load drilldown behavior).

For "Unclassified" we'll use the existing `classificationFilter=unassigned` mode in Conversations (rows with no `classification` value), filtered to the April 2026 date range.

## Changes

**`src/pages/insights/TicketTypesTab.tsx`**
- Wrap each bucket KPI card in a `Link` to:
  `/conversations?from=<monthStart>&to=<monthEnd>&classification=<bucket|unassigned>&showAll=1`
- Add hover affordance (cursor + subtle ring).
- Pass `month` prop down from `Insights.tsx` so the tab knows the date range.

**`src/pages/Insights.tsx`**
- Pass the currently selected `month` into `<TicketTypesTab />`.

**`src/pages/Conversations.tsx`**
- Read `classification` query param on first render and seed `classificationFilter` from it (treated like the existing owner/showAll drilldown — bypasses localStorage).
- Include `paramClassification` in the `isReportOwnerDrilldown`-style reset effect so it lands clean.

## Result

From `/insights` → Ticket types tab, clicking the **Unclassified** card (or any bucket) opens Conversations scoped to that month and classification, ready to triage. For April 2026 you'll see exactly the unclassified rows that make up the count.
