

## Fix: Thread parser name collision in message body

### Root cause
`parseThread` uses `raw.indexOf(parts[i+1].name, startIdx)` to find where the current message ends. When a message body contains another sender's name (e.g. "@Mark Schlosser" in Joel's reply), it finds the in-body mention instead of the next header line, truncating the body to empty.

### Fix
Instead of searching for the raw name string, use the already-known positions from the regex matches. The `parts` array already captures `startIdx` (end of header), but we need the **start** of each header line to use as the boundary.

**File: `src/lib/parseThread.ts`**

1. Store the header's start position (`match.index`) alongside `startIdx` in the parts array
2. Change line 104 to use `parts[i+1].headerIdx` (the start of the next header match) instead of searching for the name string

```typescript
// Change parts type to include headerIdx
let parts: { name: string; startIdx: number; timeStr: string; headerIdx: number }[] = [];

// In each regex loop, store match.index as headerIdx
parts.push({ name: ..., startIdx: ..., timeStr: ..., headerIdx: match.index });

// Fix boundary: use the known header position
const endIdx = i + 1 < parts.length ? parts[i + 1].headerIdx : raw.length;
```

This eliminates the string search entirely and uses deterministic positions from the regex matches.

### Files to change
- `src/lib/parseThread.ts` — ~5 line changes across the parts array type, push calls, and endIdx calculation

