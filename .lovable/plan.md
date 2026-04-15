

## Fix: Search still fails for partial UUIDs

### Root cause
PostgREST does **not** support `ilike` on UUID columns directly. The filter `id.ilike.%312d14c3%` silently fails (returns no matches) because `id` is a UUID type, not text. PostgREST requires an explicit cast: `id::text.ilike.%312d14c3%`.

However, the Supabase JS client's `.or()` method does not support the `::text` cast syntax either. So we need a different approach.

### Solution
Instead of trying to use `id.ilike` in the `.or()` filter (which doesn't work for UUID columns), split the search into two strategies:

1. **Text fields**: Keep the existing `.or()` filter for all text columns (subject, contact_name, owner, etc.)
2. **UUID partial match**: Run a separate query using `.filter('id::text', 'ilike', ilike)` — PostgREST supports cast syntax in the `.filter()` method — then merge results

Alternatively, the simpler approach: use `.or()` but reference `id::text` with the PostgREST column cast syntax. PostgREST actually supports `id::text.ilike.%q%` in the filter string passed to `.or()`.

### Changes

**File: `src/pages/Conversations.tsx`** (lines 756-778)

Replace `id.ilike.${ilike}` with `id::text.ilike.${ilike}` in all three `.or()` filter strings:

- conversation_mappings `.or()`: `id::text.ilike.${ilike},...`
- gmail_conversations `.or()`: `id::text.ilike.${ilike},...`
- manual_conversations `.or()`: `id::text.ilike.${ilike},...`

This is a 3-line change (one per table query).

