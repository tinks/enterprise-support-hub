

## Add Custom Date Range Filter to Stats Page

### What
Add a "Custom" option to the time range filter that opens a date range picker (two calendars: start and end), letting users define an arbitrary window.

### Changes

**File: `src/pages/Stats.tsx`**

1. **Extend `TimeRange` type** to include `"custom"` and add state for `customFrom` / `customTo` (`Date | undefined`).

2. **Add "Custom" tab trigger** to the existing range `Tabs` component. When selected, show a popover with two date pickers (From / To) using the existing `Calendar`, `Popover`, and `Button` components.

3. **Update `getCutoffDate` and filtering logic** — when range is `"custom"`, use `customFrom`/`customTo` directly instead of computing a cutoff. Filter checks both `isAfter(date, customFrom)` and `isBefore(date, customTo)` (with `isBefore` imported from `date-fns`).

4. **Update `rangeLabel`** to show the selected custom range formatted as "Mar 01 – Mar 15" in the chart descriptions.

### UI Layout
The custom date picker appears inline next to the range tabs when "Custom" is selected — two popover buttons ("From: Mar 01" / "To: Mar 15") using the Shadcn date picker pattern with `pointer-events-auto` on the Calendar.

### No new dependencies
Uses existing `Calendar`, `Popover`, `PopoverTrigger`, `PopoverContent`, `Button` components already in the project.

