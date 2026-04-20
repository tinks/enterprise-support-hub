

## Include manual Slack threads in "Conversations by channel"

### Scope (this pass)
Just get manual `slack_thread` / `slack_dm` rows showing up in the analytics chart and clickable. No name normalization beyond the obvious (case + leading `#`) — you'll clean up channel names manually afterwards.

### Plan

**1. `src/pages/Stats.tsx` — extend `channelData`**
- Add a small helper: `normalizeChannelName(raw)` → lowercase, trim, strip a single leading `#`. Nothing else (no `_`/`-` collapsing — you'll handle naming manually).
- After the existing loop over `filtered` (Slack mappings), loop over `filteredManual`:
  - `source === 'slack_dm'` → bucket into the existing `__DM__` "Direct message" entry.
  - `source === 'slack_thread'` with a non-empty `link` → bucket key `manual:${normalizeChannelName(link)}`, display name `#${normalized}`.
  - `source === 'slack_thread'` with empty/missing `link` → bucket key `manual:__unknown__`, display name `#unknown`.
- If a normalized manual name happens to match the resolved name of a real `C…` channel bar, keep them separate for now (different `channel_id`, so the bar stacks won't merge). You can collapse them after renaming.

**2. `src/pages/Stats.tsx` — bar click**
- Existing `__DM__` and `C…` cases unchanged.
- New `manual:<name>` bars → navigate to `/conversations?manualChannel=<name>&source=slack`.
- `manual:__unknown__` → `/conversations?manualChannel=__unknown__&source=slack`.

**3. `src/pages/Conversations.tsx` — `manualChannel` filter**
- Read `manualChannel` from query params alongside existing `channel` / `channelGroup`.
- When set, show only `source === 'manual'` rows where `normalizeChannelName(link)` equals the param (or `link` is empty when param is `__unknown__`).
- Add a dismissible chip "Showing manually imported threads from #<name>" matching the existing channel/DM chip style, with a "Back to analytics" shortcut.

**4. `.lovable/project-knowledge.md`**
- Update the "Analytics — channel drilldown" section: manual `slack_thread` rows are now counted, keyed by normalized `link` (lowercase, leading `#` stripped, no other transforms). `slack_dm` rows fold into the "Direct message" bucket. Drilldown URL: `?manualChannel=<name>&source=slack`.

### Files
- Edit: `src/pages/Stats.tsx`
- Edit: `src/pages/Conversations.tsx`
- Edit: `.lovable/project-knowledge.md`

### Out of scope
- Backfilling/renaming `link` values in `manual_conversations` — you'll do this manually via the UI.
- Adding manual rows to other Slack-only charts (volume, resolution time, escalation).
- Flow page update — pure analytics presentation tweak.

