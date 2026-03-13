

## Persist node positions to the database

### Problem
Node positions are hardcoded in the source code. When you drag nodes around, positions live only in React state. When I edit the file, those positions reset to the hardcoded defaults.

### Solution
Save node positions to a database table so drag changes persist across code edits and page reloads.

### Changes

**1. Database migration — create `flow_node_positions` table**
```sql
CREATE TABLE public.flow_node_positions (
  id text PRIMARY KEY,           -- matches node id ("1", "2", "3a", etc.)
  x double precision NOT NULL,
  y double precision NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.flow_node_positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to flow_node_positions"
  ON public.flow_node_positions FOR ALL TO public
  USING (true) WITH CHECK (true);
```

**2. `src/pages/FlowDiagram.tsx`**

- On mount, fetch saved positions from `flow_node_positions`. Merge them over the hardcoded defaults (DB positions win).
- Add an `onNodeDragStop` handler that upserts the new position to the database (debounced or on drag end).
- The `buildNodes` function continues to define default positions as fallback, but the component overrides them with DB values when available.

```text
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│ buildNodes  │────▶│ merge DB positions│────▶│ useNodesState│
│ (defaults)  │     │ over defaults     │     │ (draggable)  │
└─────────────┘     └──────────────────┘     └──────────────┘
                                                    │
                                              onNodeDragStop
                                                    │
                                                    ▼
                                          ┌──────────────────┐
                                          │ upsert position  │
                                          │ to DB            │
                                          └──────────────────┘
```

Key implementation detail: positions save on drag end (not continuously), so there's no performance concern.

