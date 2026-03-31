

## Add "Product area" dropdown and "Bug" toggle columns to conversations table

### Database changes
Add two new columns to both `conversation_mappings` and `gmail_conversations`:

```sql
ALTER TABLE conversation_mappings
  ADD COLUMN product_area text DEFAULT NULL,
  ADD COLUMN is_bug boolean NOT NULL DEFAULT false;

ALTER TABLE gmail_conversations
  ADD COLUMN product_area text DEFAULT NULL,
  ADD COLUMN is_bug boolean NOT NULL DEFAULT false;
```

Product area options: `SSO`, `Credits`, `Account access`, `Remix/transfer`

### UI changes — `src/pages/Conversations.tsx`

1. **Interfaces**: Add `product_area: string | null` and `is_bug: boolean` to both `ConversationMapping` and `GmailConversation`
2. **Table header**: Add two new `<TableHead>` columns after "Resolved": `Product area` and `Bug`
3. **For each row** (both Slack and Gmail):
   - **Product area cell**: Inline `<Select>` dropdown with a placeholder "—", options SSO / Credits / Account access / Remix/transfer. On change, persist to DB optimistically with error revert + toast.
   - **Bug cell**: `<Switch>` toggle, same optimistic pattern as Test/Resolved toggles.
4. **New handler functions**: `updateProductArea(id, value, source)` and `toggleBug(id, currentValue, source)` — optimistic update → Supabase write → revert on error.
5. Click handlers on the select and switch use `e.stopPropagation()` to prevent row navigation.

### Flow diagram — `src/pages/FlowDiagram.tsx`
Document the new Product area and Bug columns on the conversations table.

### Files to edit
- Database migration (2 ALTER TABLE statements)
- `src/pages/Conversations.tsx` — interfaces, headers, cells, handlers
- `src/pages/FlowDiagram.tsx` — document change

