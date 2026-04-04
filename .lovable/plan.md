

## Fix the disappearing Reset button on the Inbox page

### Problem
The "Reset" button only appears when columns are reordered (`isCustomOrder`). It does not clear date/source/owner/status filters, and it vanishes once columns are reset — even if date filters are still active.

### Solution
Replace the current conditional Reset button with one that:
1. Is visible whenever **any** filter is active (source ≠ "all", owner ≠ "all", hiddenStatuses > 0, dateFrom set, dateTo set, or isCustomOrder)
2. Clears **everything** in one click: source → "all", owner → "all", hiddenStatuses → empty, dateFrom → undefined, dateTo → undefined, columnOrder → default

### Implementation

**`src/pages/Conversations.tsx`**

- Compute an `anyFilterActive` boolean from all filter states + `isCustomOrder`
- Replace the `{isCustomOrder && (<Button>Reset</Button>)}` block with `{anyFilterActive && (<Button onClick={resetAll}>Reset</Button>)}`
- `resetAll` function clears all filter state and resets column order

### Files to edit
- `src/pages/Conversations.tsx`

