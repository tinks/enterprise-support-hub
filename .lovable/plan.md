

## Consolidate Date Filter into a Single Dropdown on Stats Page

### What Changes

Replace the current `Tabs` component for date range selection on the Stats page with a single `Select` dropdown. The dropdown lists all predefined ranges (7 days, 30 days, 90 days, All) plus a "Custom range" option. When "Custom" is selected, the two calendar date pickers appear inline next to it — same as today.

### Technical Details

**File: `src/pages/Stats.tsx`**

- Replace the date range `Tabs` (lines 289-297) with a `Select` component:
  - `SelectTrigger` showing the current range label
  - `SelectContent` with `SelectItem` entries for "7d", "30d", "90d", "all", "custom"
- Keep the custom date pickers conditional block (lines 298-324) unchanged
- Update the `onValueChange` to call `setRange` — same state, just different UI control
- Remove `Tabs`/`TabsTrigger`/`TabsList` imports if the production/test tabs are the only remaining usage (they still use Tabs, so keep those imports)
- Add `Select`, `SelectContent`, `SelectItem`, `SelectTrigger`, `SelectValue` imports

