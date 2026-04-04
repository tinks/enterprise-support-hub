

## Group Gmail and Slack statistics into separate sections

### What changes
Reorganize the Stats page to visually separate Gmail and Slack statistics into clearly labeled sections instead of interleaving them. Shared charts (conversation volume, hourly activity, heatmap) stay in a third "Combined" section.

### Layout

```text
┌─────────────────────────────────┐
│ Hero + Filters                  │
├─────────────────────────────────┤
│ ▸ Slack statistics (section)    │
│   - Summary cards (total,       │
│     resolved, cancelled, open,  │
│     escalated, success rate)    │
│   - Resolution time cards       │
│   - Resolution distribution     │
│   - Resolution time trend       │
│   - Conversations by channel    │
│   - Daily outcomes              │
│   - Status distribution         │
│   - Cumulative conversations    │
│   - Escalation rate trend       │
├─────────────────────────────────┤
│ ▸ Gmail statistics (section)    │
│   - Summary cards (email total, │
│     messages, resolved, open)   │
│   - Resolution time cards       │
│   - Threads by customer         │
├─────────────────────────────────┤
│ ▸ Combined activity             │
│   - Avg / day card              │
│   - Conversation volume chart   │
│   - Activity by hour            │
│   - Activity heatmap            │
├─────────────────────────────────┤
│ Insights footer                 │
└─────────────────────────────────┘
```

When source filter is "Slack only", the Gmail section is hidden. When "Gmail only", the Slack section is hidden. When "All sources", both show.

### Implementation

**`src/pages/Stats.tsx`**

1. After the filters block (~line 818), add a section heading + wrapper for Slack stats:
   - `{sourceFilter !== "gmail" && (<div className="space-y-6"><h2>` with text "Slack" and a `Separator` below
   - Move into this wrapper: Slack summary cards (lines 822-901), resolution time cards + charts (lines 911-978), conversations by channel (lines 1153-1178), daily outcomes + status distribution (lines 1180-1233), cumulative + escalation rate (lines 1235-1289)

2. Add a section heading + wrapper for Gmail stats:
   - `{sourceFilter !== "slack" && (<div className="space-y-6"><h2>` with text "Gmail" and a `Separator`
   - Move into this wrapper: Gmail summary cards (lines 831-861), Gmail resolution time (lines 981-998), threads by customer (lines 1001-1026)

3. Add a section heading for combined/shared stats:
   - `<div className="space-y-6"><h2>` with text "Combined activity" and a `Separator`
   - Contains: Avg/day card (lines 902-908), conversation volume (lines 1028-1063), hourly activity (lines 1065-1091), heatmap (lines 1093-1151)

4. Section heading style: `<h2 className="text-lg font-semibold text-foreground">Slack</h2>` followed by `<Separator />`

### Files to edit
- `src/pages/Stats.tsx`

