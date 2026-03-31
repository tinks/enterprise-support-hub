

## Add separate "Resolved" toggle column to conversations table

### Problem
Currently there's only a "Test" toggle column. The Gmail "Resolve" button exists but is not a toggle, and Slack rows have no resolve UI at all. The user wants two independent toggles side by side: **Test** (exclude from stats) and **Resolved** (mark as resolved).

### Approach
Both `conversation_mappings` and `gmail_conversations` already have `status` and `resolved_at` columns in the database — no schema changes needed. We just need to add a new "Resolved" column with a `Switch` toggle that reads/writes the `status` field.

### Changes

**`src/pages/Conversations.tsx`**

1. Add a new `<TableHead>Resolved</TableHead>` column after the existing "Test" column
2. For **Slack rows**: add a `Switch` that is checked when `m.status === 'resolved'`, and on toggle:
   - Optimistically update status to `'resolved'` (+ set `resolved_at`) or back to `'active'` (+ clear `resolved_at`)
   - Write to `conversation_mappings` table
   - Revert + toast on error
3. For **Gmail rows**: replace the current "Resolve" button with a `Switch` toggle using the same pattern — checked when `g.status === 'resolved'`, toggles between `'resolved'` and `'open'`
   - Write to `gmail_conversations` table
   - Revert + toast on error
4. Remove the existing Gmail "Resolve" button (replaced by the toggle)

**`src/pages/FlowDiagram.tsx`** — document the new resolved toggle column

### Technical detail
```tsx
// Slack resolved toggle
const toggleResolved = async (id, currentStatus, source) => {
  const newStatus = currentStatus === 'resolved' ? (source === 'slack' ? 'active' : 'open') : 'resolved';
  const resolvedAt = newStatus === 'resolved' ? new Date().toISOString() : null;
  // optimistic update, then supabase write, revert on error
};
```

### Files to edit
- `src/pages/Conversations.tsx` — add Resolved toggle column, remove Resolve button
- `src/pages/FlowDiagram.tsx` — document the change

