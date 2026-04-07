

## Add "Awaiting engineering" status option

### What changes
Add `awaiting_engineering` to the status dropdown on the conversation detail page, with appropriate label and color.

### Implementation

**`src/pages/ConversationDetail.tsx`**

1. **Line 104** — Add `"awaiting_engineering"` to `STATUS_OPTIONS`:
   ```ts
   const STATUS_OPTIONS = ["active", "resolved", "cancelled", "escalated", "awaiting_context", "awaiting_support", "awaiting_engineering"];
   ```

2. **Lines 112-113** — Add a case in `statusColor`:
   ```ts
   case "awaiting_engineering": return "outline" as const;
   ```

3. **Lines 120-121** — Add a case in `statusLabel`:
   ```ts
   case "awaiting_engineering": return "Awaiting engineering";
   ```

4. **`src/pages/Stats.tsx`** — Add `awaiting_engineering` to any status filtering logic (e.g., the `awaiting` count at ~line 372) so it appears in analytics. Add a `chartConfig` entry if needed.

### Files to edit
- `src/pages/ConversationDetail.tsx`
- `src/pages/Stats.tsx`

