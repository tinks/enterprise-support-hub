

## Persist conversation filter settings across page refreshes

### Problem
The source filter and status filter reset to defaults on every page refresh.

### Approach
Use `localStorage` to persist `sourceFilter` and `hiddenStatuses`. Read saved values on mount, write on change.

### Changes

**`src/pages/Conversations.tsx`**

1. **Source filter** (~line 97): Initialize from `localStorage` (falling back to URL param, then `"all"`):
   ```tsx
   const saved = localStorage.getItem("conv-source-filter") as SourceFilter | null;
   const [sourceFilter, setSourceFilter] = useState<SourceFilter>(paramSource || saved || "all");
   ```
   Add a `useEffect` to persist on change:
   ```tsx
   useEffect(() => { localStorage.setItem("conv-source-filter", sourceFilter); }, [sourceFilter]);
   ```

2. **Hidden statuses** (~line 100): Initialize from `localStorage`:
   ```tsx
   const savedHidden = localStorage.getItem("conv-hidden-statuses");
   const [hiddenStatuses, setHiddenStatuses] = useState<Set<string>>(
     savedHidden ? new Set(JSON.parse(savedHidden)) : new Set(["test", "cancelled", "resolved"])
   );
   ```
   Add a `useEffect` to persist on change:
   ```tsx
   useEffect(() => { localStorage.setItem("conv-hidden-statuses", JSON.stringify([...hiddenStatuses])); }, [hiddenStatuses]);
   ```

### Files to edit
- `src/pages/Conversations.tsx` — 2 init changes + 2 small useEffects

