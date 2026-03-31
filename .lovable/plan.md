

## Add bug, feature request, and product area controls to conversation detail page

### Problem
The conversation detail page (`/conversations/:id`) is missing the bug toggle, feature request toggle, and product area dropdown that exist on the list page. Users must go back to the list to classify conversations.

### Changes

**`src/pages/ConversationDetail.tsx`**

1. Add `is_bug`, `is_feature_request`, and `product_area` to the `ConversationMapping` interface

2. Fetch dynamic product areas from `settings` table (same pattern as Conversations.tsx) on mount

3. Add three toggle/select handlers:
   - `toggleBug` — update `is_bug` in `conversation_mappings`
   - `toggleFeatureRequest` — update `is_feature_request`
   - `updateProductArea` — update `product_area`

4. Add a new section in the details card (after the existing rows) with:
   - Bug toggle (Switch) — same as list page
   - Feature request toggle (Switch)
   - Product area dropdown (Select with dynamic options from settings + "None")

**`src/pages/FlowDiagram.tsx`** — Document that classification controls are now available on the detail page.

### Files to edit
- `src/pages/ConversationDetail.tsx` — interface update, settings fetch, 3 handlers, 3 UI controls
- `src/pages/FlowDiagram.tsx` — document change

