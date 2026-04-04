

## Widen Message/Subject column

### Problem
The Message/Subject column has no minimum width set, so it gets squeezed by the fixed-width columns (ID at 40px, Status/Owner/Product area at 120px each).

### Solution
Add `min-w-[300px]` to the `message` column in `TableHead` and all `TableCell` variants. This gives it a reasonable minimum while still allowing it to grow with available space.

### Implementation

**`src/pages/Conversations.tsx`**

Update 6 locations where column class names are computed — add `col === "message" ? "min-w-[300px]" : ""` to the className template string:

1. `TableHead` (~line 1441)
2. Slack `TableCell` (~line 1462)
3. Gmail main `TableCell` (~line 1488)
4. Gmail sub-row `TableCell` (~line 1500)
5. Manual `TableCell` (~line 1517)

Each line changes from:
```
${""} ${col === "id" ? ...
```
to:
```
${col === "message" ? "min-w-[300px]" : ""} ${col === "id" ? ...
```

### Files to edit
- `src/pages/Conversations.tsx`

