

## Add "Sam" and "CSM" as owner options

### Changes

**`src/pages/Conversations.tsx`**
- Update `OWNER_OPTIONS` to `["Joel", "Kristina", "Sam", "CSM"]`
- Update `OwnerFilter` type to include `"Sam"` and `"CSM"`

**`src/pages/ConversationDetail.tsx`**
- Update `OWNER_OPTIONS` to `["Joel", "Kristina", "Sam", "CSM"]`

**`src/pages/FlowDiagram.tsx`**
- Update owner references to list all valid owner values: Joel, Kristina, Sam, CSM

### Files to edit
- `src/pages/Conversations.tsx`
- `src/pages/ConversationDetail.tsx`
- `src/pages/FlowDiagram.tsx`

