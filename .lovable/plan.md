## Goal

Make picking the Thread date in Log conversation → Paste thread faster by adding month + year quick selectors above the calendar grid, so the user doesn't have to click the chevrons many times to get to an older month.

## Approach

Use shadcn's `Calendar` `captionLayout="dropdown-buttons"` (or build month/year `Select` dropdowns above the calendar) inside the existing Popover. The dropdowns let the user jump straight to any month and year between, say, 2023 and the current year.

## Changes

### 1. `src/components/ManualLogTab.tsx` — Thread date popover

Replace the current `<Calendar mode="single" …/>` with a dropdown-enabled variant:

```tsx
<Calendar
  mode="single"
  selected={threadDate}
  onSelect={(d) => { setThreadDate(d); setDateAutoDetected(false); }}
  captionLayout="dropdown-buttons"
  fromYear={2023}
  toYear={new Date().getFullYear()}
  defaultMonth={threadDate ?? new Date()}
  initialFocus
  className="p-3 pointer-events-auto"
/>
```

This renders month + year as Select dropdowns in the calendar caption while keeping the existing day grid, navigation chevrons, and auto-detect helper text.

### 2. `src/components/ui/calendar.tsx` — verify dropdown styling

The shadcn calendar already supports `captionLayout`. If the dropdowns don't inherit theme styles, add minimal class overrides for `caption_dropdowns`, `dropdown`, and `vhidden` in the `classNames` prop so the selects use `bg-popover text-popover-foreground` and match the rest of the form.

### 3. Out of scope

- No change to `detectThreadDate()` or the auto-detect flow.
- No change to other date pickers in the app (only the Thread date one in Log conversation).
- No change to date storage or `combineDateTime()` logic.

## Files touched

- `src/components/ManualLogTab.tsx` — add `captionLayout`, `fromYear`, `toYear`, `defaultMonth` props.
- `src/components/ui/calendar.tsx` — only if dropdown styling needs a small tweak.
