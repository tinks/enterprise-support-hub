

## Remove FR toggle, backfill classification from existing FR flags

### What it does
Removes the "FR" toggle switch column from the conversations table and detail view. Where `is_feature_request` is currently `true` and `classification` is null, backfills `classification = 'FR'` in the database so no data is lost.

### Database migration
Backfill classification from existing FR flags (only where classification is not already set):
```sql
UPDATE conversation_mappings SET classification = 'FR' WHERE is_feature_request = true AND classification IS NULL;
UPDATE gmail_conversations SET classification = 'FR' WHERE is_feature_request = true AND classification IS NULL;
UPDATE manual_conversations SET classification = 'FR' WHERE is_feature_request = true AND classification IS NULL;
```

### Code changes

**`src/pages/Conversations.tsx`**
- Remove `"feature_req"` from `ALL_COLUMNS`
- Remove the `toggleFeatureRequest` function
- Remove all three `case "feature_req"` render blocks (Slack ~line 871, Gmail ~line 1000, Manual ~line 1133)
- Remove the `feature_req` label from the column header map

**`src/pages/ConversationDetail.tsx`**
- Remove the "Feature request" toggle switch row (~line 773-774)
- Remove `"is_feature_request"` from the `toggleField` function's type union (keep `"is_test"` and `"is_bug"`)

**`src/pages/FlowDiagram.tsx`**
- Document that FR toggle was removed; FR is now tracked via the Classification dropdown

### Files to edit
- Database migration (backfill)
- `src/pages/Conversations.tsx`
- `src/pages/ConversationDetail.tsx`
- `src/pages/FlowDiagram.tsx`

