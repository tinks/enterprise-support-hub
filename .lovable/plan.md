

## Fix manual channel drilldown + normalize channel names

### Three things to do

**1. Backfill DB — collapse 3 variants into one canonical name**

Run a migration that updates `manual_conversations.link` for the affected rows:
- `#ext_lovable-control-tower` → `ext_lovable-control-tower` (2 rows)
- `ext-lovable-control-tower` → `ext_lovable-control-tower` (6 rows)
- `ext_lovable-control-tower` → unchanged (6 rows)

Result: all 14 rows share `link = 'ext_lovable-control-tower'`.

**2. Stop accepting `#` in new manual entries (`src/components/ManualLogTab.tsx`)**

In `handleSave` (around line 137), strip a single leading `#` and trim before insert:
```ts
const cleanChannel = (raw: string) => raw.trim().replace(/^#/, "").trim();
link: mode === "paste" ? (cleanChannel(channelName) || null) : (cleanChannel(link) || null),
```
Also add a tiny visual hint under the "Channel name" input: *"No # needed — added automatically in display."* No need to police mid-string `#`s.

**3. Fix the empty-inbox bug (`src/pages/Conversations.tsx`)**

Root cause: Stats links to `?manualChannel=...&source=slack`. That sets `sourceFilter = "slack"`, and the `manualData` loop at line 841 is gated to `"all" | "manual" | "intercom"` — so manual rows never enter `rows`, and the `paramManualChannel` filter at line 892 ends up filtering an empty set.

Two coordinated changes:

- **Stats.tsx** — when navigating for a manual bucket, drop the `&source=slack` (it's misleading anyway since manual rows have `source = 'manual'` in DB). Use just `?manualChannel=<name>`.
- **Conversations.tsx** — when `paramManualChannel` is present on mount, force `sourceFilter` to `"manual"` (so the manual loop runs and the chip+filter dropdown stay consistent). This also fixes anyone with bookmarked `?manualChannel=...&source=slack` URLs from the previous version.

After this, clicking `#ext_lovable-control-tower` in the chart shows all 14 conversations.

### Files
- New migration: backfill 3 link variants → canonical name
- Edit: `src/components/ManualLogTab.tsx` (strip leading `#` on save)
- Edit: `src/pages/Stats.tsx` (drop `source=slack` from manual drilldown URL)
- Edit: `src/pages/Conversations.tsx` (force `sourceFilter = "manual"` when `manualChannel` param present)
- Edit: `.lovable/project-knowledge.md` (note: manual channel names are stored without `#`; drilldown URL no longer carries `source=slack`)

### Out of scope
- Renaming/canonicalizing other manual channel link values (only `ext_lovable-control-tower` variants exist with this issue today; future imports won't accumulate `#` prefixes after fix #2).
- Collapsing `_` ↔ `-` automatically in the matcher — the DB backfill makes this unnecessary for control-tower; future divergent names are a manual-rename problem.

