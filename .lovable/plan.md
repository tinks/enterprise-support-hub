

## Fix product areas not persisting

### Root cause
Two issues:

1. **Stale closure bug** in `ProductAreasCard.tsx`: The `addArea` and `removeArea` functions use `areas` (derived at render time) inside the `setSettings` callback, instead of recomputing from the callback's `s` parameter. This means rapid additions can overwrite each other.

2. **No auto-save**: Product area changes only update local state. The user must manually click "Save settings" on the parent card. If they navigate away or refresh first, changes are lost.

### Fix

**`src/components/ProductAreasCard.tsx`**

1. Fix the stale closure in `addArea` — recompute `areas` from the `s` parameter inside the `setSettings` callback:
   ```ts
   setSettings((s) => {
     if (!s) return s;
     const current = (s.product_areas || "").split(",").map(x => x.trim()).filter(Boolean);
     if (current.includes(trimmed)) return s;
     return { ...s, product_areas: [...current, trimmed].join(",") };
   });
   ```

2. Same fix for `removeArea` — recompute from `s` instead of outer `areas`.

3. Add auto-save: accept an `onSave` callback prop from the parent, and call it after each add/remove so changes persist immediately without needing the global "Save settings" button.

**`src/pages/Index.tsx`**

4. Pass a `onSave` prop to `ProductAreasCard` that calls `saveSettings()` (or a lightweight version that just updates `product_areas`).

**`src/pages/FlowDiagram.tsx`** — Document that product area edits now auto-save.

### Files to edit
- `src/components/ProductAreasCard.tsx` — fix closures + add auto-save callback
- `src/pages/Index.tsx` — pass onSave prop
- `src/pages/FlowDiagram.tsx` — document change

