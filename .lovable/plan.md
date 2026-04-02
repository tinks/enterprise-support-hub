

## Make Intercom column editable on double-click

### What it does
Double-clicking the Intercom cell on any conversation row opens an inline text input to manually set or edit the Intercom conversation ID. Pressing Enter or blurring saves it to the database; Escape cancels.

### Changes

**`src/pages/Conversations.tsx`**

1. Add state: `editingIntercomId: string | null` (row ID being edited), `editingIntercomValue: string` (current input value)

2. Create an `IntercomEditCell` inline component that:
   - Shows the current display (link, "Create" button, or "—") by default
   - On `onDoubleClick`, sets `editingIntercomId` to the row ID and populates the input with the current value
   - When editing, renders an `<Input>` (auto-focused, small) instead of the display
   - On Enter or blur: saves the value to the appropriate Supabase table (`conversation_mappings` for slack, `gmail_conversations` or `manual_conversations` for others) and updates local state
   - On Escape: cancels editing

3. Update `renderSlackCell` case `"intercom"`: wrap existing content with double-click handler; when `editingIntercomId === m.id`, show the input instead

4. Update `renderGmailCell` and `renderManualCell` case `"intercom"`: same pattern — double-click to edit, save to the corresponding table. For Gmail, save to `gmail_conversations` (would need a new column or use an existing field). For manual, save to `manual_conversations`.

   Since `gmail_conversations` and `manual_conversations` don't have an `intercom_conversation_id` column, a migration will add nullable `intercom_conversation_id text` columns to both tables.

5. Stop propagation on double-click to prevent row navigation.

**Database migration** — Add `intercom_conversation_id` column to `gmail_conversations` and `manual_conversations` tables.

**`src/pages/FlowDiagram.tsx`** — Document that Intercom IDs can be manually edited via double-click.

### Files to edit
- `src/pages/Conversations.tsx` — inline edit logic
- `src/pages/FlowDiagram.tsx` — document change
- Database migration for new columns

