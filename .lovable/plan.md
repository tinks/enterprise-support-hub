

## Add manual entries statistics section

### What changes
Add a new "Manual entries" section on the Stats page, between the Gmail section and Combined activity section, showing KPIs and a breakdown for manually logged conversations. Also fetch `manual_conversations` data alongside Slack and Gmail, apply the same time/environment filters, and add "Manual entry" to the source filter.

### Layout

```text
┌─────────────────────────────────┐
│ Slack section                   │
├─────────────────────────────────┤
│ Gmail section                   │
├─────────────────────────────────┤
│ Manual entries section (NEW)    │
│  KPIs: Total, Active, Resolved │
│  Chart: By source breakdown    │
│  Chart: By owner               │
├─────────────────────────────────┤
│ Combined activity               │
└─────────────────────────────────┘
```

### Implementation

**`src/pages/Stats.tsx`**

1. **Add interface + state**:
   - `interface ManualRow { status: string; created_at: string; is_test: boolean; source: string; owner: string | null; classification: string | null; }`
   - New state: `const [manualData, setManualData] = useState<ManualRow[]>([])`

2. **Update `SourceFilter` type** from `"all" | "slack" | "gmail"` to `"all" | "slack" | "gmail" | "manual"` and add a `<SelectItem value="manual">Manual entry</SelectItem>` to the source filter dropdown.

3. **Fetch manual_conversations in `loadStats`**: Add a third query to the `Promise.all` fetching `status, created_at, is_test, source, owner, classification` from `manual_conversations`.

4. **Add `filteredManual` useMemo**: Same pattern as `filtered`/`filteredGmail` — filter by view (test/real) and date range.

5. **Add manual stats to the `stats` useMemo**: Compute `manualTotal`, `manualActive` (status === "active"), `manualResolved` (status === "resolved").

6. **Add manual entries by source breakdown** (`useMemo`): Group `filteredManual` by `source` field (e.g. "teams", "phone", "slack_dm", "other") and count, for a horizontal bar chart.

7. **Add manual entries by owner** (`useMemo`): Group `filteredManual` by `owner` and count, for a horizontal bar chart.

8. **Render new section** (between Gmail section and Combined activity):
   - Section heading: "Manual entries" with separator
   - KPI cards row: Total, Active, Resolved (3-column grid)
   - By source bar chart (horizontal)
   - By owner bar chart (horizontal)
   - Show/hide based on `sourceFilter !== "slack" && sourceFilter !== "gmail"`

9. **Update `chartConfig`** with a `manual` entry (color: `"#4ECDC4"`).

10. **Include manual data in Combined activity volume chart**: Add a `manual` area/line to the merged volume data, using the manual entry color.

11. **Update FlowDiagram.tsx** with a note about the new manual entries stats section.

### Files to edit
- `src/pages/Stats.tsx`
- `src/pages/FlowDiagram.tsx`

