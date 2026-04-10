

## Color-code inbox rows requiring action

### Current behavior
Rows with no owner get a coral left border + light coral background (`border-l-[3px] border-primary/70 bg-primary/5`). All other rows look the same regardless of status.

### Change
Add a distinct highlight for conversations with `awaiting_support` status (meaning a customer replied and the team needs to act). This will use an **amber/yellow** left border and tinted background, visually distinct from the coral "unassigned" highlight.

Priority order (if both apply, unassigned takes precedence since it's the more urgent signal):
1. **No owner** → coral border (existing)
2. **`awaiting_support`** → amber border (new)

### File: `src/pages/Conversations.tsx`

Update the three `<TableRow>` className expressions (Slack ~line 1631, Gmail ~line 1650, Manual ~line 1679) to add an amber highlight when status is `awaiting_support` and the row already has an owner:

```tsx
// Example for Slack row (same pattern for Gmail and Manual):
className={`cursor-pointer hover:bg-muted/50 transition-colors ${
  m.is_test ? "opacity-50" : ""
} ${
  !m.owner
    ? "border-l-[3px] border-primary/70 bg-primary/5"
    : m.status === "awaiting_support"
    ? "border-l-[3px] border-amber-500/70 bg-amber-50/50"
    : ""
}`}
```

### File: `src/pages/FlowDiagram.tsx`
Document the new color-coding: amber = awaiting support action, coral = unassigned.

### Files to edit
- `src/pages/Conversations.tsx` — add amber highlight for `awaiting_support` rows
- `src/pages/FlowDiagram.tsx` — document the color-coding scheme

