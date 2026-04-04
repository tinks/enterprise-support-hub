

## Combine From/To into a single Date range picker

### What changes
Replace the two separate "From" and "To" date popovers with a single "Date" popover. One click on the calendar sets the From date, a second click sets the To date, then the popover auto-closes. The trigger button shows the selected range (e.g. "04 Apr – 10 Apr") or just "Date" when nothing is selected.

### Implementation

**`src/pages/Conversations.tsx`**

1. Remove `fromPopoverOpen` and `toPopoverOpen` states. Add a single `datePopoverOpen` state.
2. Add a `dateStep` state: `"from" | "to"` — tracks which click the user is on. Defaults to `"from"`.
3. Replace both `<Popover>` blocks and the clear-dates button with one `<Popover>`:
   - Trigger button label logic:
     - No dates: `"Date"`
     - Only from: `"04 Apr –"`
     - Both: `"04 Apr – 10 Apr"`
   - Highlight border when either date is set
4. Single `<Calendar>` inside, using `mode="single"`:
   - `onSelect` handler:
     - If `dateStep === "from"`: set `dateFrom`, clear `dateTo`, set `dateStep` to `"to"`
     - If `dateStep === "to"`: set `dateTo` (ensure it's ≥ dateFrom, swap if not), close popover, reset `dateStep` to `"from"`
   - Show visual range highlight using `modifiers` and `modifiersStyles` to style days between from and to
5. When popover closes (via `onOpenChange`), reset `dateStep` to `"from"`
6. Update active-filter badge count: count date range as 1 filter (if either dateFrom or dateTo is set) instead of counting them separately
7. Keep the small X clear button next to the date trigger when dates are active

### Files to edit
- `src/pages/Conversations.tsx`

