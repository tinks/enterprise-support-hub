

## Rename "awaiting_context" display label and add "awaiting_support" status

### What it does
1. Renames the display label for `awaiting_context` status from "awaiting_context" to "Awaiting customer" everywhere in the UI (the database value stays `awaiting_context`)
2. Adds a new status `awaiting_support` to all status lists and filters

**Note:** This is a UI-only label change for `awaiting_context` — no database migration needed. The new `awaiting_support` status is just a string value that can be set on the existing `status` text columns.

### Changes

**`src/pages/Conversations.tsx`**
- Add a `statusLabel()` helper that maps internal status values to display labels (e.g., `awaiting_context` → "Awaiting customer", `awaiting_support` → "Awaiting support", others → capitalize as-is)
- Add `"awaiting_support"` to `ALL_STATUSES` array
- Use `statusLabel()` in the three status Badge renders (lines ~789, ~921, ~1008) and in the status filter checkboxes

**`src/pages/ConversationDetail.tsx`**
- Add `"awaiting_support"` to `STATUS_OPTIONS`
- Add same `statusLabel()` helper
- Use it in status Badge and status Select dropdown items
- Add color mapping for `awaiting_support` in `statusColor()`

**`src/pages/Stats.tsx`**
- Rename `awaiting_context` label from "Awaiting context" to "Awaiting customer"
- Add `awaiting_support` entry to chart config and stats counting

**`src/pages/FlowDiagram.tsx`**
- Update status filter documentation to include `awaiting_support`
- Document the label rename

### Files to edit
- `src/pages/Conversations.tsx`
- `src/pages/ConversationDetail.tsx`
- `src/pages/Stats.tsx`
- `src/pages/FlowDiagram.tsx`

