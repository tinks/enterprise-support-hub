

## Fix inconsistent product area column alignment

### Problem
The `SelectTrigger` for the product area column is `w-[130px]` but the `TableCell` containing it is only `w-[120px]`. This mismatch causes the select dropdowns to overflow their cells inconsistently, creating the visual misalignment visible in the screenshot.

### Solution

**`src/pages/Conversations.tsx`**
- Change all `SelectTrigger` widths for product_area from `w-[130px]` to `w-full` so they fill their cell naturally
- Increase the `TableCell` width for product_area from `w-[120px]` to `w-[140px]` to give enough room for longer values like "Main Product"
- Apply this consistently across all three render functions (Slack, Gmail, Manual)

### Files to edit
- `src/pages/Conversations.tsx`

