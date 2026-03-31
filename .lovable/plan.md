

## Add "Feature request" toggle and "Cloud/AI" product area option

### Changes

**Database migration** — Add `is_feature_request` boolean column to both tables:
```sql
ALTER TABLE conversation_mappings ADD COLUMN is_feature_request boolean NOT NULL DEFAULT false;
ALTER TABLE gmail_conversations ADD COLUMN is_feature_request boolean NOT NULL DEFAULT false;
```

**`src/pages/Conversations.tsx`**
1. Add `is_feature_request: boolean` to both interfaces
2. Add `"Cloud/AI"` to `PRODUCT_AREAS` array
3. Add `toggleFeatureRequest` handler (same pattern as `toggleBug`)
4. Add "Feature req." table header next to "Bug"
5. Add Switch cell for both Slack and Gmail rows

**`src/pages/FlowDiagram.tsx`** — Document the new column and product area option.

### Files to edit
- Database migration (2 ALTER TABLE statements)
- `src/pages/Conversations.tsx`
- `src/pages/FlowDiagram.tsx`

