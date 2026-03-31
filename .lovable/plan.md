

## Add multi-select status filter to conversations

### Approach
Replace the proposed simple "active/all" toggle with a multi-select dropdown that lets you independently hide/show each status. Use checkboxes inside a popover so multiple statuses can be toggled at once.

### Statuses to filter
Based on existing code: `active`, `resolved`, `escalated`, `cancelled`, `awaiting_context`, plus the `is_test` flag (treated as a virtual "test" filter).

### Changes

**`src/pages/Conversations.tsx`**

1. Add state for excluded statuses — default to hiding `test`, `cancelled`, and `resolved`:
   ```tsx
   const [hiddenStatuses, setHiddenStatuses] = useState<Set<string>>(
     new Set(["test", "cancelled", "resolved"])
   );
   ```

2. Add a filter popover next to the source `Select` (~line 344) using a `Popover` + checkboxes for each status option: `active`, `awaiting_context`, `escalated`, `resolved`, `cancelled`, `test`. Each checkbox toggles that value in/out of `hiddenStatuses`. Label shows count of active filters (e.g. "Status (3 hidden)").

3. Update the `unified` useMemo (~line 277) to filter rows based on `hiddenStatuses`:
   ```tsx
   let filtered = rows;
   if (hiddenStatuses.size > 0) {
     filtered = rows.filter(r => {
       if (hiddenStatuses.has("test") && r.data.is_test) return false;
       if (hiddenStatuses.has(r.data.status)) return false;
       return true;
     });
   }
   ```

4. Add `hiddenStatuses` to the useMemo dependency array.

**`src/pages/FlowDiagram.tsx`** — Document the new multi-select status filter.

### Files to edit
- `src/pages/Conversations.tsx` — state, filter popover UI, filtering logic
- `src/pages/FlowDiagram.tsx` — document change

