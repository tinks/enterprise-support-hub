

## Why the inbox shows zero — and the actual fix

### The two real bugs

**Bug 1: page size ignores `paramManualChannel`**
In `src/pages/Conversations.tsx` line 664:
```ts
const pageSize = (isHeatmapMode || isResolutionMode || isDayOnlyMode || paramChannel || paramChannelGroup) ? 1000 : 50;
```
`paramManualChannel` is missing from this list, so the manual query loads only the 50 most recent manual rows out of 314. Most control-tower rows (especially the older active one from 2026-04-01) never enter the dataset, so the channel filter at line 894 has nothing to match.

**Bug 2: default status filter hides `resolved`**
`DEFAULT_HIDDEN = {test, cancelled, resolved}` (line 374). 13 of the 14 control-tower rows are `resolved`, so even if they were loaded they'd be hidden. Clicking a chart bar means "show me everything in this channel" — hiding 13/14 by default defeats the drilldown.

### About the `#` you keep seeing
The hashtag is **not in the database** and **not in the URL param**. It's a literal prefix added at render time:
- Chip: `#{paramManualChannel}` (line 1518)
- Channel column: `` `#${normalizeChannelName(mc.link)}` ``
That's just visual styling to mimic Slack channel naming. It's not the culprit.

### Fix

**1. `src/pages/Conversations.tsx` — bump pageSize for manual drilldown**
Add `paramManualChannel` to the line 664 condition so the manual query loads up to 1000 rows when drilling into a channel:
```ts
const pageSize = (isHeatmapMode || isResolutionMode || isDayOnlyMode || paramChannel || paramChannelGroup || paramManualChannel) ? 1000 : 50;
```

**2. `src/pages/Conversations.tsx` — bypass status hiding when `paramManualChannel` is active**
At line 927, change:
```ts
if (!searchResults) {
```
to:
```ts
if (!searchResults && !paramManualChannel) {
```
Same intent as the existing search-bypass: when the user explicitly drilled into a channel, show all statuses for that channel. (Owner, product-area, classification filters still apply — the user can still narrow.)

**3. `src/pages/Conversations.tsx` — make it discoverable that status hiding is off for this view**
Update the chip at line 1518 to add a small muted suffix: "Showing all statuses." So the user knows resolved rows are intentionally included.

**4. `.lovable/project-knowledge.md`**
Document: when navigating to the inbox via a manual channel drilldown (`?manualChannel=...`), the page (a) loads up to 1000 manual rows so the full channel set is available, and (b) bypasses the default status hiding so resolved threads are visible. Owner / product-area / classification filters still apply.

### Why this fixes it
After this change, clicking `#ext_lovable-control-tower` in the chart will:
- Load all 314 manual rows (well under the 1000 cap)
- Match all 14 with `link = 'ext_lovable-control-tower'`
- Show all 14 regardless of status (resolved rows included)

### Out of scope
- Removing the cosmetic `#` prefix (it's intentional Slack-style labeling, not a bug).
- Backfilling further channel-name variants (none exist for control-tower; the DB is clean).
- Changing the default `DEFAULT_HIDDEN` for the normal inbox view — only the drilldown view bypasses it.

