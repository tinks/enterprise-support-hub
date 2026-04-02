
## Make Gmail Intercom editing reliable without double-click

### Why the current Gmail behavior is failing
The current Intercom edit interaction depends on double-clicking inside a Gmail table row. Gmail rows are also used for expand/collapse behavior when emails are grouped by thread/subject. That means the first click can already trigger row-level interaction and cause a re-render before the second click completes, so the double-click pattern is fragile specifically for Gmail.

### Better approach
Replace double-click editing with an explicit inline edit action in the Intercom cell for all sources, or at minimum for Gmail:
- show the current Intercom link/value as today
- always show a small pencil button on hover
- clicking the pencil enters edit mode immediately
- Enter saves, Escape cancels, blur saves
- keep the existing “Create” button for Slack imports

This avoids conflicting with Gmail row grouping and is much more discoverable than double-click.

### Implementation plan

1. Update `src/pages/Conversations.tsx`
- Refactor `renderIntercomCell` so edit mode is opened by clicking a dedicated pencil button instead of `onDoubleClick`
- keep `onClick={(e) => e.stopPropagation()}` on the cell wrapper and new edit button
- for Gmail grouped rows and sub-rows, this should work consistently because a single explicit click is easier to isolate than a double-click gesture
- preserve current save logic to:
  - `conversation_mappings` for Slack
  - `gmail_conversations` for Gmail
  - `manual_conversations` for Manual
- optionally keep double-click as a secondary shortcut, but do not depend on it

2. Improve Gmail row interaction boundaries
- make sure all interactive Gmail cells stop propagation, especially the Intercom cell
- keep expand/collapse only on the row body or chevron/id area, not on controls inside the row

3. Add clearer affordance
- replace the hover-only passive pencil icon with an actual small edit button/icon button
- add tooltip text like “Edit Intercom ID”
- when empty, show “Edit” or “Add ID” rather than only “—” so the action is obvious

4. Update `src/pages/FlowDiagram.tsx`
- replace the note about double-click editing with the new explicit edit action
- mention that this change was made because Gmail rows can be grouped/expandable, so a dedicated edit control is more reliable

### Technical details
```text
Current issue:
Gmail row click = expand/collapse group
Intercom cell double-click = edit
These interactions compete.

Safer model:
[Intercom value/link] [pencil button]
click pencil -> enter input
Enter/blur -> save
Escape -> cancel
```

### Files to edit
- `src/pages/Conversations.tsx`
- `src/pages/FlowDiagram.tsx`
