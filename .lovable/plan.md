

## Fix auto-open calendar on "Custom range" selection

### Problem
When selecting "Custom range", both `setRange("custom")` and `setCustomDatePopoverOpen(true)` fire in the same React batch. The Popover component only mounts when `range === "custom"`, so Radix doesn't properly handle receiving `open=true` on its very first render. The calendar shows the "Select dates" button but doesn't auto-open.

### Solution
Use a `useEffect` to open the popover after the Popover component has mounted, instead of setting the state synchronously in the `onValueChange` handler.

### Implementation

**`src/pages/Stats.tsx`**

1. Remove the `setCustomDatePopoverOpen(true)` call from the `onValueChange` handler (line 690)

2. Add a `useEffect` that watches `range` and opens the popover when it becomes `"custom"`:
```tsx
useEffect(() => {
  if (range === "custom") {
    // Small delay to let the Popover mount first
    const t = setTimeout(() => setCustomDatePopoverOpen(true), 50);
    return () => clearTimeout(t);
  }
}, [range]);
```

### Files to edit
- `src/pages/Stats.tsx`

