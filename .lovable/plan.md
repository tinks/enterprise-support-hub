

## Auto-open calendar when "Custom range" is selected

### What changes
When the user selects "Custom range" from the Timeframe dropdown, the date picker popover opens automatically — no need for a second click.

### Implementation

**`src/pages/Stats.tsx`**

1. In the `onValueChange` handler of the Timeframe `Select` (~line 690), after setting the range, also open the popover if custom is selected:

```tsx
onValueChange={(v) => {
  setRange(v as TimeRange);
  if (v === "custom") {
    setCustomDatePopoverOpen(true);
  }
}}
```

### Files to edit
- `src/pages/Stats.tsx`

