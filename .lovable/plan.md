

## Add "Timeframe" Label to Date Range Dropdown

### What Changes

Add a `Timeframe:` label before the date range `Select` dropdown, matching the existing `Channels:` label style.

### Technical Details

**File: `src/pages/Stats.tsx`** — Line 290

Wrap the `Select` in a `div` with a label span, same pattern as the Channels filter (line 333-334):

```tsx
<div className="flex items-center gap-2">
  <span className="text-sm font-medium text-muted-foreground">Timeframe:</span>
  <Select ...>
```

