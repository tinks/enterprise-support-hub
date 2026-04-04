

## Auto-advance from "From" to "To" date picker

### What changes
When the user selects a date in the "From" popover, it will automatically close and open the "To" popover, so they can quickly set a date range without an extra click.

### Implementation detail

**`src/pages/Conversations.tsx`**

1. Add two controlled `open` states: `fromPopoverOpen` and `toPopoverOpen` (using `useState<boolean>`)
2. Convert both `<Popover>` components from uncontrolled to controlled (`open` + `onOpenChange` props)
3. In the "From" calendar's `onSelect` handler, after setting `dateFrom`:
   - Close the From popover (`setFromPopoverOpen(false)`)
   - Open the To popover (`setToPopoverOpen(true)`)
4. The "To" popover uses its own controlled state normally

### Files to edit
- `src/pages/Conversations.tsx`

