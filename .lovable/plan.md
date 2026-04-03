

## Separate Search/Refresh from Filters section

### What changes
Currently all controls (search, source, owner, status, dates, refresh, reset) live together inside a single Collapsible. The user wants:
1. **Search + Refresh + Reset columns** to be a persistent top bar (always visible, not collapsible)
2. **Filters** (source, owner, status, date from/to, clear dates) in a visually distinct collapsible section below, toggled by click

### Layout

```text
┌─────────────────────────────────────────────┐
│  CardHeader                                 │
├─────────────────────────────────────────────┤
│  [🔍 Search...]          [Reset cols] [⟳]  │  ← always visible row
├─────────────────────────────────────────────┤
│  ▸ Filters (2 active)              [toggle] │  ← click to expand/collapse
│  ┌─────────────────────────────────────────┐│
│  │ Source | Owner | Status | From | To | ✕ ││
│  └─────────────────────────────────────────┘│
├─────────────────────────────────────────────┤
│  Table rows...                              │
└─────────────────────────────────────────────┘
```

### Implementation detail

**`src/pages/Conversations.tsx`** (lines ~1219-1347)

1. Replace the single `Collapsible` block with two sections:
   - **Top bar** (`div` with `border-t border-border px-6 py-3 flex items-center gap-2`): Search input, Reset columns button (if custom order), Refresh button
   - **Filters section** (`Collapsible` with `border-t border-border`): Source select, Owner select, Status popover, Date from/to popovers, Clear dates button
2. The Filters `Collapsible` defaults to open, toggle via click on the trigger row
3. Trigger row shows "Filters" label with a chevron icon; includes a small badge showing count of active filters (source ≠ all, owner ≠ all, hiddenStatuses > 0, dateFrom set, dateTo set)
4. Add `transition-all` on `CollapsibleContent` for smooth expand/collapse animation

### Files to edit
- `src/pages/Conversations.tsx`

