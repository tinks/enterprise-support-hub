

## Restore default hidden statuses on Reset

### Problem
The default hidden statuses are correctly set to Resolved, Cancelled, and Test on initial load (matching the screenshot). However, clicking "Reset" clears all hidden statuses to an empty set instead of restoring these defaults.

### Changes

**`src/pages/Conversations.tsx`**

1. Extract the default hidden statuses into a constant: `const DEFAULT_HIDDEN = new Set(["test", "cancelled", "resolved"])`
2. Update `resetAll` to restore `hiddenStatuses` to `DEFAULT_HIDDEN` instead of an empty set
3. Update `anyFilterActive` to compare current `hiddenStatuses` against `DEFAULT_HIDDEN` rather than checking `size > 0` — so the Reset button only appears when the status filter differs from the default
4. Update the filter badge count logic similarly — only count status as an active filter when it differs from the default

### Files to edit
- `src/pages/Conversations.tsx`

