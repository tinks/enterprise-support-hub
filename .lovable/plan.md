

## Make "Conversations by channel" bars clickable to drill down

### What I found
- The chart lives in `src/pages/Stats.tsx` (~line 1314), rendered as a `<BarChart>` with `<Bar dataKey="total">`.
- `channelData` (line 593) is built from `filtered` Slack mappings, keyed by `slack_channel_id`. Currently it stores only `{ channel: name, total }` — the channel ID is lost.
- Other charts (volume, heatmap, resolution) already drill down using `navigate('/conversations?...')` with query params.
- `src/pages/Conversations.tsx` already reads query params (`day`, `hour`, `source`, `resolutionMin/Max`) at line 184–189 — but does **not** yet support a `channel` filter.

### Why bug-hunting/ask-sso bars look weird
These are valid Slack channel IDs that the bot was once mentioned in (or had a thread imported from). Letting the user click into them confirms which conversations they are, instead of leaving them as a mystery total.

### Plan

1. **`src/pages/Stats.tsx`**
   - Update `channelData` memo to also include the `channel_id` for each entry.
   - Add `onClick` handler to the `<Bar>` (Recharts passes the clicked datum) that navigates to `/conversations?channel=<id>&source=slack` — reusing existing source filter when relevant.
   - Add a subtle `cursor-pointer` style and update the `CardDescription` to hint "Click a bar to see conversations".

2. **`src/pages/Conversations.tsx`**
   - Read `channel` query param (alongside existing `day`, `hour`, etc.).
   - In the `unified` filter pipeline, when `paramChannel` is set, only include Slack rows where `slack_channel_id === paramChannel` (and exclude Gmail/Manual rows).
   - Show a small filter chip at the top (matching existing day/hour chip pattern) with the channel name and a clear "×" to remove it.

3. **No backend changes** — pure UI + routing.

### Files
- Edit: `src/pages/Stats.tsx`
- Edit: `src/pages/Conversations.tsx`

### Out of scope
- Adding clickable drilldown to the per-source channel charts inside the Slack analytics section (can be a follow-up if useful).
- Updating the Flow page (this is a UI navigation change, no logic flow change).

