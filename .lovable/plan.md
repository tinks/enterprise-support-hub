

## Group all DMs as "Direct Message" in analytics

### What I found
- Slack IDs starting with `D` = 1:1 direct messages. There are 13 distinct DM IDs in `conversation_mappings` (~19 total conversations).
- In `src/pages/Stats.tsx`, `channelData` (around line 593) keys by `slack_channel_id`, so every DM becomes its own bar with a noisy auto-resolved name (`DM: <person>`).
- The drilldown I just added (`/conversations?channel=<id>&source=slack`) currently filters by exact `slack_channel_id`, which won't work for a grouped "Direct Message" bar.

### Plan

1. **`src/pages/Stats.tsx` — group DMs in `channelData`**
   - When building the channel aggregate, detect IDs starting with `D` (and optionally `G` for legacy group DMs) and bucket them under a single synthetic entry: `{ channel: "Direct Message", channel_id: "__DM__", total: <sum> }`.
   - Keep individual `C…` channels as separate bars.
   - Sort so "Direct Message" appears in normal alphabetical position (or pin it last — I'll go alphabetical to match existing behavior).

2. **`src/pages/Stats.tsx` — drilldown for the DM bar**
   - When the clicked bar's `channel_id === "__DM__"`, navigate to `/conversations?channelGroup=dm&source=slack` instead of the per-channel param.

3. **`src/pages/Conversations.tsx` — support `channelGroup=dm`**
   - Read the new `channelGroup` query param.
   - When `channelGroup === "dm"`, filter Slack rows to those where `slack_channel_id` starts with `D` (or `G` if we include legacy group DMs).
   - Show a filter chip "Direct messages" with a clear "×" — same pattern as the existing channel chip.

4. **Keep individual DM drilldown working**
   - The existing `?channel=<id>` path continues to work for anyone with a bookmarked link to a single DM.

5. **No DB / edge function changes** — pure UI grouping.

### Files
- Edit: `src/pages/Stats.tsx`
- Edit: `src/pages/Conversations.tsx`

### Open question (small)
Should legacy `G…` IDs (group DMs / old private channels) also be folded into "Direct Message"? My recommendation: **no** — keep `G` as their own bars since some are private channels with meaningful names. The current data has zero `G` rows anyway, so it's a no-op today. I'll only group `D…`.

### Out of scope
- Renaming the auto-resolved DM names elsewhere in the app.
- Backend changes to `list-slack-channels`.
- Flow page update — this is a pure analytics presentation tweak, no logic flow change.

