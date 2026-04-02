

## Add missing classification dropdown to Slack rows

### Problem
The classification dropdown was added to Gmail and Manual row renderers but is missing from the Slack `renderSlackCell` function. That's why the two Slack rows in the screenshot show an empty classification cell.

### Fix

**`src/pages/Conversations.tsx`**
- Add a `case "classification"` block to `renderSlackCell` (after the `case "bug"` block, before the closing `}`) with the same `<Select>` dropdown pattern used in the Gmail and Manual renderers

The code to add (after line 857, before line 858's closing `}`):

```typescript
case "classification": return (
  <Select value={m.classification || ""} onValueChange={(v) => updateClassification(m.id, v, "slack")}>
    <SelectTrigger className="h-8 w-[130px] text-xs" onClick={(e) => e.stopPropagation()}>
      <SelectValue placeholder="—" />
    </SelectTrigger>
    <SelectContent>
      {CLASSIFICATION_OPTIONS.map((opt) => (
        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
      ))}
      {m.classification && <SelectItem value="clear" className="text-muted-foreground">Clear</SelectItem>}
    </SelectContent>
  </Select>
);
```

### Files to edit
- `src/pages/Conversations.tsx` (1 addition)

