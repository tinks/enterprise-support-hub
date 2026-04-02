

## Add classification dropdown column (keep bug toggle)

### What it does
Adds a new `classification` text column to all three conversation tables and a corresponding "Classification" column in the conversations table with a single-select dropdown offering: Issue, Configuration, Bug, FR, Question (plus clear). The existing Bug toggle switch column remains unchanged.

### Database migration
Add `classification` text column (nullable) to all three tables:
```sql
ALTER TABLE conversation_mappings ADD COLUMN classification text;
ALTER TABLE gmail_conversations ADD COLUMN classification text;
ALTER TABLE manual_conversations ADD COLUMN classification text;
```

### Code changes

**`src/pages/Conversations.tsx`**
- Add `"classification"` to `ALL_COLUMNS` (after `"feature_req"` or similar position)
- Add `classification` to all three interfaces and data fetches
- Add `updateClassification(id, value, source)` function that updates the `classification` column
- Render a `<Select>` dropdown in all three source renderers with options: Issue, Configuration, Bug, FR, Question, and a clear/unset option
- Column header label: "Classification"

**`src/pages/ConversationDetail.tsx`**
- Add `classification` to interfaces and data fetches
- Add a Classification dropdown in the Classification card (alongside the existing Bug/FR toggles)
- Add `updateClassification` function

**`src/pages/OwnerDashboard.tsx`**
- Pass through the classification column (it reuses Conversations component via `forceOwner`)

**`src/pages/Stats.tsx`**
- Add classification breakdown to stats if relevant

**`src/pages/FlowDiagram.tsx`**
- Document the new classification field

### Files to edit
- Database migration (add `classification` column to 3 tables)
- `src/pages/Conversations.tsx`
- `src/pages/ConversationDetail.tsx`
- `src/pages/Stats.tsx`
- `src/pages/FlowDiagram.tsx`

