

## Replace Production/Test Tabs with Environment Dropdown

### What Changes

Replace the `Tabs` component for Production/Test view toggle with a `Select` dropdown labeled "Environment:", matching the Timeframe and Channels filter pattern.

### Technical Details

**File: `src/pages/Stats.tsx`**

- Lines 284-289: Replace the `Tabs`/`TabsList`/`TabsTrigger` block with a labeled `Select` dropdown:
  ```tsx
  <div className="flex items-center gap-2">
    <span className="text-sm font-medium text-muted-foreground">Environment:</span>
    <Select value={view} onValueChange={(v) => setView(v as "real" | "test")}>
      <SelectTrigger className="w-[180px] h-9">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="real">Production</SelectItem>
        <SelectItem value="test">Test</SelectItem>
      </SelectContent>
    </Select>
  </div>
  ```
- Remove `Tabs`, `TabsList`, `TabsTrigger` imports if no longer used elsewhere in the file

