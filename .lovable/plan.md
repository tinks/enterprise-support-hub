

## Fix Gmail grouped row: expand vs. navigate conflict

### Problem
When a Gmail row has grouped threads (groupCount > 1), clicking the row **only** toggles expand/collapse. There is no way to navigate to the conversation detail. Non-grouped Gmail rows navigate fine.

### Proposed solution
Split the two actions clearly:

1. **Expand/collapse via chevron button** -- The expand chevron in the ID column (already exists at line 951-965) handles toggling the group. Make the row click **always navigate** to the detail page, and use `e.stopPropagation()` on the chevron button to prevent navigation when expanding.

2. **Row click always navigates** -- Change the `onClick` on the grouped Gmail `<TableRow>` to always navigate to `/conversations/${g.id}?source=gmail`, same as non-grouped rows.

This means:
- Clicking anywhere on the row opens the conversation detail
- Clicking the small chevron/badge in the ID column expands/collapses the thread group (without navigating)

### Implementation

**`src/pages/Conversations.tsx`**

1. **Line 1486-1493** -- Change the `onClick` handler on the grouped Gmail `<TableRow>` from the conditional expand logic to always navigate:
   ```tsx
   onClick={() => navigate(`/conversations/${g.id}?source=gmail`)}
   ```

2. **Lines 951-965** (the chevron button in `renderGmailCell`) -- The existing `onClick` already calls `e.stopPropagation()`, so expanding will not trigger row navigation. No change needed here.

### Result
- Clicking a Gmail row always opens the detail page (consistent with Slack and Manual rows)
- The chevron icon in the ID column still expands/collapses grouped threads
- Sub-rows already navigate on click (line 1505) -- no change needed

### Files to edit
- `src/pages/Conversations.tsx`

