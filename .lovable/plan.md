

## Add "Total incoming cases" summary section before Slack

### What changes
Add a new top-level section before the Slack section showing one KPI card: **Total incoming cases**, computed as the sum of Slack total + Gmail total + Manual entries total from the already-computed `stats` object.

### Implementation

**`src/pages/Stats.tsx`**

1. Insert a new section block just before the `{/* ── Slack section ── */}` block (~line 885):
   - Section heading: "Overview" with separator
   - Single KPI card showing `stats.total + stats.gmailTotal + stats.manualTotal` with label "Total incoming cases"
   - Always visible regardless of source filter

2. The values `stats.total`, `stats.gmailTotal`, and `stats.manualTotal` already exist in the `stats` useMemo (~lines 349-352), so no new computation is needed.

### Files to edit
- `src/pages/Stats.tsx`

