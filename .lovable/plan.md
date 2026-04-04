

## Widen Message column and shrink Status, Owner, Product area

### What changes
- Double the Message/Subject column width from `max-w-[300px]` to `min-w-[600px]`
- Add compact width classes to Status, Owner, and Product area columns so they only take space needed for their content
- Apply these width constraints in both `TableHead` and `TableCell` for all row types (Slack, Gmail, Gmail sub-rows, Manual)

### Implementation

**`src/pages/Conversations.tsx`**

1. In the `TableHead` rendering (~line 1432), add column-specific width classes:
   - `col === "message"` → `min-w-[600px]`
   - `col === "status" || col === "owner" || col === "product_area"` → `w-[120px]`

2. In all `TableCell` renderings (Slack line 1462, Gmail line 1488, Gmail sub-rows line 1500, Manual line 1517):
   - Change `col === "message"` from `max-w-[300px]` to `min-w-[600px]`
   - Add `w-[120px]` for `status`, `owner`, `product_area`

### Files to edit
- `src/pages/Conversations.tsx`

