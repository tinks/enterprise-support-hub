

## Complete Gmail integration — Stats UI + Flow diagram

### What's left

The Stats page already loads and filters Gmail data, but the UI doesn't expose it. The Conversations page is complete. Two things remain:

1. **Stats page UI enhancements**
2. **Flow diagram update**

### Stats page changes (`src/pages/Stats.tsx`)

**A. Source filter dropdown** — Add a "Source" dropdown next to the existing Environment filter (after line 421), matching the Conversations page pattern: All sources / Slack only / Gmail only.

**B. Gmail volume card** — Add a card after the "Total" card showing `stats.gmailTotal` with a Mail icon and "Gmail emails" label. Conditionally hide it when source is "slack".

**C. Volume chart Gmail overlay** — In the "Conversation volume" AreaChart, add a second Area for Gmail daily volume. Merge `gmailVolumeData` into `volumeData` so each day object has both `total` (Slack) and `gmail` keys. When source filter is "gmail", show only the Gmail area; when "slack", only Slack; when "all", show both.

**D. Source-aware summary cards** — When source is "gmail", hide Slack-specific cards (Resolved, Cancelled, Open, Escalated, Success rate) since Gmail has no statuses. Show only Total (gmail count) and Avg/day.

### Flow diagram changes (`src/pages/FlowDiagram.tsx`)

Add a new node for the Gmail polling branch:
- Node: "Gmail polling" — description: "Edge function polls Gmail DL every 15 min, stores email metadata in gmail_conversations table"
- Connected from a root/start node to show it as a parallel intake path alongside Slack

### Files changed
- `src/pages/Stats.tsx` — source filter UI, Gmail card, chart overlay, conditional card visibility
- `src/pages/FlowDiagram.tsx` — new Gmail polling node + edge

