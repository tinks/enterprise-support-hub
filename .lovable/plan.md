

## Add Channel Filter and Chart to Stats Page

### What Changes

1. **Expand data fetch** — Include `slack_channel_id` in the `conversation_mappings` query (currently only fetches `status, created_at, is_test`). Update the `Mapping` interface accordingly.

2. **Channel name resolution** — Reuse the same `channelNameOverrides` map from `Conversations.tsx` (extract to a shared constant or duplicate). Also call the `list-slack-channels` edge function on load to resolve any IDs not in the overrides, falling back to the raw ID.

3. **Channel filter** — Add a multi-select or dropdown filter (below the existing time range tabs) that lets the user pick one or more channels by name. Default: all channels selected. The `filtered` memo will additionally filter by selected channels.

4. **"Conversations by Channel" bar chart** — Add a new horizontal `BarChart` card showing conversation count per channel (using resolved channel names as Y-axis labels). This goes after the existing two-column chart section. Color bars by status (stacked: resolved, escalated, active, awaiting).

### Technical Details

**File: `src/pages/Stats.tsx`**

- Add `slack_channel_id` to `Mapping` interface and Supabase select query
- Add state: `channelNames: Record<string, string>`, `selectedChannels: string[]`
- On data load, collect unique channel IDs → resolve names via overrides + edge function call
- Add `channelFilter` to the `filtered` useMemo
- New `channelData` useMemo: group filtered data by channel, count by status
- Render a channel filter (multi-select chips or dropdown) in the filters bar
- Render a new `Card` with a stacked horizontal `BarChart` for channel breakdown

