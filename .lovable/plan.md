

## Create a "Filters" section on the Inbox page

### What changes
The filter controls (search, source, owner, status, date from/to, refresh, reset columns) currently sit inline in the `CardHeader` row. They will be moved into a dedicated collapsible "Filters" section with a title, placed between the card header and the table content.

### Layout

```text
┌─────────────────────────────────────────────┐
│  CardHeader (empty title area only)         │
├─────────────────────────────────────────────┤
│  Filters                          [▾ toggle]│
│  ┌─────────────────────────────────────────┐│
│  │ Search | Source | Owner | Status |      ││
│  │ From date | To date | Refresh | Reset   ││
│  └─────────────────────────────────────────┘│
├─────────────────────────────────────────────┤
│  Table rows...                              │
└─────────────────────────────────────────────┘
```

### Implementation detail

**`src/pages/Conversations.tsx`**

1. Strip the filter controls out of the `CardHeader` (lines ~1219-1338), leaving only the empty title div.
2. Add a new section between `CardHeader` and `CardContent` using a `Collapsible` component (already available in `src/components/ui/collapsible.tsx`):
   - Title: "Filters" (sentence case) with a chevron toggle
   - Default state: open
   - Contains a `flex flex-wrap items-center gap-2 px-6 pb-4` div with all the moved filter controls (search input, source select, owner select, status popover, date from/to popovers, clear dates button, refresh button, reset columns button)
3. The filters section gets a subtle top border or separator for visual clarity.

### Files to edit
- `src/pages/Conversations.tsx`

