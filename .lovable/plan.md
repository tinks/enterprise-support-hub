

## Replace separate From/To calendars with a single date-range calendar

### What changes
When "Custom range" is selected in the Timeframe dropdown, instead of showing two separate calendar popovers (From and To), show a single popover with one calendar. The first click sets the From date, the second click sets the To date and auto-closes the popover. A trigger button displays the selected range (e.g. "Apr 01 – Apr 04") or "Select dates" when empty.

### Implementation

**`src/pages/Stats.tsx`**

1. Add a `customDateStep` state (`"from" | "to"`, default `"from"`) and a `customDatePopoverOpen` state (boolean)

2. Replace the entire `{range === "custom" && (...)}` block (lines 702-728) with a single `Popover`:
   - Trigger button shows:
     - Both dates set → `"MMM dd – MMM dd, yyyy"`
     - Only from set → `"MMM dd, yyyy – ..."`
     - Neither → `"Select dates"`
   - Calendar uses `mode="range"` is not needed — keep `mode="single"` with custom logic:
     - `onSelect`: if `customDateStep === "from"`, set `customFrom`, clear `customTo`, flip step to `"to"`; if `"to"`, set `customTo` (enforce >= from), close popover, reset step to `"from"`
   - Style days between from and to using `modifiers` and `modifiersStyles` for visual range highlight
   - On `onOpenChange(false)`, reset step to `"from"`

3. Remove `toPopoverOpen` state (no longer needed)

### Files to edit
- `src/pages/Stats.tsx`

