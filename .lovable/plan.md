

## Owner dashboard pages for Joel and Kristina

### What it does
Creates two personal dashboard pages (`/my/joel` and `/my/kristina`) accessible from the top nav. Each page shows a summary of the owner's assigned conversations across all sources (Slack, Gmail, Manual) with KPI cards and a focused conversation list.

### Layout per dashboard
- **Header**: "{Name}'s conversations" with a refresh button
- **KPI cards row**: Open count, Resolved count, Bugs, Feature requests
- **Conversation table**: All conversations assigned to that owner, sorted by date (newest first), with source badge, subject/message, status, and a clickable link to the detail view. Reuses the same table styling as the main Conversations page but without filters (already scoped to owner).

### Changes

**`src/pages/OwnerDashboard.tsx`** (new)
- Single reusable page component that takes the owner name from the URL param
- Fetches from all three tables (`conversation_mappings`, `gmail_conversations`, `manual_conversations`) filtered by `owner = :name`
- Renders 4 summary cards (open, resolved, bugs, feature requests)
- Renders a simplified conversation table (source, subject/message, status, date) with row clicks navigating to `/conversations/:id?source=...`
- Uses AppLayout wrapper

**`src/App.tsx`**
- Add route: `/my/:owner` → `<OwnerDashboard />`

**`src/components/AppLayout.tsx`**
- Add two nav links after Conversations:
  - "Joel" → `/my/joel`
  - "Kristina" → `/my/kristina`
- Use `User` icon from lucide-react

**`src/pages/FlowDiagram.tsx`** — Document the owner dashboard feature

### Technical details
- The component uses a single `owner` URL param and capitalizes it for the query (`joel` → `Joel`)
- Each table query: `.select("*").eq("owner", ownerName)`
- Unified rows are built the same way as in Conversations.tsx but simpler (no search, no status filter)
- KPI counts are derived from the fetched data via `useMemo`

### Files to create/edit
- `src/pages/OwnerDashboard.tsx` (new)
- `src/App.tsx`
- `src/components/AppLayout.tsx`
- `src/pages/FlowDiagram.tsx`

