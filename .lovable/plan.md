

## Replace Badge Filters with a Filter Menu on Conversations Page

### What Changes

Replace the current badge-based channel filter with a proper **Filter Menu** bar containing two filter controls:

1. **Date filter** — A dropdown with predefined ranges (Last 7 days, Last 30 days, Last 90 days, All time) plus a "Custom range" option that opens two calendar date pickers (from/to). Filters `created_at` on the conversation mappings.

2. **Channel filter** — A searchable multi-select dropdown (Popover + Command pattern from shadcn). Lists all channels from conversation history by resolved name. User can type to search and toggle multiple channels. Selected channels shown as pills/badges inside the trigger.

Both filters apply together. The current `.limit(50)` query stays — date filtering happens client-side on fetched data (consistent with existing pattern). Remove the old badge row entirely.

### Technical Details

**File: `src/pages/Conversations.tsx`**

- Remove the badge-based channel filter UI
- Add state: `dateRange: "7d" | "30d" | "90d" | "all" | "custom"`, `customFrom: Date | undefined`, `customTo: Date | undefined`
- Update `filteredMappings` memo to apply both date and channel filters
- Render a filter bar between CardHeader and table with two controls side by side:
  - **Date**: `Select` dropdown for presets; when "custom" is chosen, show two `Popover` + `Calendar` pickers inline
  - **Channel**: `Popover` containing `Command` with `CommandInput` for search, `CommandList` of `CommandItem` entries with checkboxes for multi-select. Trigger button shows count of selected channels or "All channels"

**UI components used** (all already in project): `Select`, `Popover`, `PopoverContent`, `PopoverTrigger`, `Calendar`, `Command`, `CommandInput`, `CommandList`, `CommandItem`, `CommandEmpty`, `Checkbox`, `Button`, `Badge`

