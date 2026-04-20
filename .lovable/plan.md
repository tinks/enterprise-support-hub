

## Add "Intercom" as a source filter option

### Context
Tickets imported via the Intercom backfill / poller / webhook are stored in `manual_conversations` with `source = 'intercom'`. Currently the Source filter dropdowns only expose Slack / Gmail / Manual, so Intercom-originated tickets are bucketed under "Manual" (since they live in `manual_conversations`), making them hard to isolate.

### Pages with a Source menu
1. **`src/pages/Conversations.tsx`** (Inbox) — `SOURCE_OPTIONS` filter + per-row source label logic
2. **`src/pages/Stats.tsx`** (Analytics) — `SourceFilter` type + Select dropdown + filtering logic
3. **`src/components/ManualLogTab.tsx`** — manual entry "Source" dropdown (already free-text-ish; verify if Intercom belongs here — likely **no**, since this tab is for manually logged conversations, not auto-imported ones)

### Changes

**1. Conversations.tsx**
- Add `"intercom"` to `SOURCE_OPTIONS`.
- In the unified row builder, detect manual rows where `source === 'intercom'` and label them as `"Intercom"` (separate from `"Manual"`).
- Update source filter logic to match the new value.
- Source badge/icon: reuse manual styling but with "Intercom" label.

**2. Stats.tsx**
- Extend `SourceFilter` type: `"all" | "slack" | "gmail" | "manual" | "intercom"`.
- Add Select option.
- Split manual filtering: when source filter is `"manual"` show only `source !== 'intercom'` manual rows; when `"intercom"` show only `source === 'intercom'` manual rows.
- Cards/charts that aggregate "Manual entries" get a parallel "Intercom" view (or Intercom rolls into manual visuals but is filterable — simpler: just filter, keep existing manual cards reused).

**3. ManualLogTab.tsx**
- **Skip.** This is for human-logged conversations; Intercom tickets arrive via webhook/poller/import, not manual logging. Adding it here would be misleading.

### Why this approach
- Intercom tickets already have a distinct `source` value in the DB — no schema change needed.
- Filter-only change keeps the unified-table architecture intact.
- Keeping ManualLogTab unchanged avoids confusing users into thinking they should manually log Intercom tickets (use Import tab instead).

### Open question
For Analytics: should Intercom get **its own dedicated section** (cards + charts like Slack/Gmail/Manual sections have), or just be a **filter option** that reuses the existing Manual section visuals? The simpler/faster choice is filter-only; a dedicated section is more work but gives Intercom-specific KPIs.

### Files
- Edit: `src/pages/Conversations.tsx`
- Edit: `src/pages/Stats.tsx`
- Edit: `src/pages/FlowDiagram.tsx` (note: Source filter now exposes Intercom)

