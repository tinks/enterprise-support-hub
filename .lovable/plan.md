

## Put All Filters in a Single Row

### What Changes

Move the Channels filter into the same `flex` row as Environment and Timeframe, so all filters sit on one line instead of two separate blocks.

### Technical Details

**File: `src/pages/Stats.tsx`**

- Move the Channels filter `div` (lines 341-392) inside the existing filters `div` (line 283), after the Timeframe/custom-date-pickers block
- Remove the wrapping `{allChannelIds.length > 1 && (...)}` conditional from being a separate sibling — keep the condition but place it inline within the filters row
- The outer `flex flex-wrap items-center gap-4` container already handles wrapping, so no layout changes needed

Result: Environment, Timeframe (+ custom pickers when active), and Channels all appear in one `flex-wrap` row.

