

## Make Message/Subject column compact

### What changes
Remove the `min-w-[600px]` constraint from the Message/Subject column so it sizes naturally based on available space, matching the compact approach used by other columns.

### Implementation

**`src/pages/Conversations.tsx`**

Replace all 6 occurrences of `col === "message" ? "min-w-[600px]" : ""` with `""` (or remove the ternary entirely):

1. TableHead (~line 1441)
2. Slack TableCell (~line 1462)
3. Gmail main TableCell (~line 1488)
4. Gmail sub-row TableCell (~line 1500)
5. Manual TableCell (~line 1517)

The column will auto-size to fill remaining space after the fixed-width columns (ID, Status, Owner, Product area).

### Files to edit
- `src/pages/Conversations.tsx`

