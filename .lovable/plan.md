

## Add owner tracking and filtering to conversations

### What it does
Adds an "Owner" column to all three conversation tables (Slack, Gmail, Manual) so each conversation can be assigned to Kristina or Joel. Includes an owner filter dropdown on the conversations page.

### Database migration
Add an `owner` column (nullable text) to all three tables:
- `conversation_mappings` — `ALTER TABLE ADD COLUMN owner text`
- `gmail_conversations` — `ALTER TABLE ADD COLUMN owner text`
- `manual_conversations` — `ALTER TABLE ADD COLUMN owner text`

### Changes

**`src/pages/Conversations.tsx`**
1. Add `owner` to the `ConversationMapping`, `GmailConversation`, and `ManualConversation` interfaces
2. Add `"owner"` to `ALL_COLUMNS`
3. Add owner filter state (similar to source filter): `ownerFilter` with values `"all" | "Joel" | "Kristina" | "unassigned"`
4. Add owner filter dropdown next to the source filter
5. Apply owner filter in the `useMemo` that builds the unified list
6. Render the owner column as a `<Select>` dropdown (Joel / Kristina / unassigned) — clicking saves directly to the appropriate table
7. Include `owner` in the data fetches for all three tables

**`src/pages/ConversationDetail.tsx`**
- Add owner selector to the detail view header area

**`src/pages/FlowDiagram.tsx`** — Document owner tracking

### Files to edit
- Database migration (add `owner` column to 3 tables)
- `src/pages/Conversations.tsx`
- `src/pages/ConversationDetail.tsx`
- `src/pages/FlowDiagram.tsx`

