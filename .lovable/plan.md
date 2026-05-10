## Goal

Two refinements to the Report's Top accounts card:

1. Resolve raw Slack channel IDs (e.g. `#C08Q0B29A79`) to their actual channel names.
2. Merge the Gmail and Intercom columns into a single "Email" column (deduped by domain).

## Changes

### 1. Resolve Slack channel names (ReportTab + CustomersTab)

Currently both tabs invoke `list-slack-channels` with `body: {}`, which only returns channels the bot is currently a member of (plus public channels visible via `conversations.list`). Channels the bot was kicked from, archived channels, or some private channels are missing — so their IDs render raw.

The edge function already supports a `channelIds` param with a 3-tier resolver (`conversations.list` → `conversations.info` direct → connector-gateway fallback). We just need to pass the actual IDs from this month's tickets.

Changes in `src/pages/insights/ReportTab.tsx` and `src/pages/insights/CustomersTab.tsx`:
- After tickets load, collect the unique set of `customer_raw_id` values where `customer_kind === "slack"`.
- Invoke `list-slack-channels` with `{ channelIds: [...] }` instead of `{}`.
- Merge resolved names into `channelMap` (preserving `channelNameOverrides` as the highest priority).
- Re-run the call when the ticket set changes (e.g., when the user switches month).

This guarantees per-channel-id resolution, even for channels the bot isn't in.

### 2. Merge Intercom + Gmail into one "Email" column

In `src/pages/insights/ReportTab.tsx` `computeStats`:
- Collapse `gmailMap` and `intercomMap` into a single `emailMap` keyed by domain.
- Any ticket with `customer_kind === "domain"` and `display_source` in `("gmail", "intercom")` is added to `emailMap`. Same domain across both sources sums into one row (e.g. `lovable.dev` Gmail 58 + Intercom 35 = 93).
- Drop the `intercomAccounts` field; rename to `emailAccounts`.

Layout change in the Top accounts card:
- Replace the 3-column grid (`Slack | Gmail | Intercom`) with a 2-column grid (`Slack | Email`).
- Subtitle becomes: "Slack by channel · Email by sender domain (Gmail + Intercom contacts combined). Slack-routed Intercom cases are counted under Slack."
- Click-to-expand row still shows Bugs / FRs / CSAT.

## Files touched

- `src/pages/insights/ReportTab.tsx` — pass `channelIds` to `list-slack-channels`; merge gmail+intercom buckets; switch to 2-column layout.
- `src/pages/insights/CustomersTab.tsx` — pass `channelIds` to `list-slack-channels` so the customers table also resolves all referenced channels.
- `.lovable/project-knowledge.md` — update the per-channel grouping note to reflect the merged Email column.
