

## Fix flyout menu clipped by sidebar overflow

### Problem
The sidebar `<aside>` has `overflow-hidden` which is needed to hide label text when collapsed, but it also clips the Dashboards flyout menu that extends beyond the sidebar boundary.

### Fix

**`src/components/AppLayout.tsx`**
- Change the sidebar's `overflow-hidden` to `overflow-visible` so the flyout can extend beyond the sidebar
- Move the text-clipping behavior to the individual nav link labels instead, using `overflow-hidden` on the `<nav>` content area or on the label `<span>` elements — but since the width transition on the sidebar itself already hides the text (the sidebar shrinks to 56px), `overflow-hidden` on the `<aside>` can simply be removed. The `transition-all` on the width already handles the visual collapsing.

Single line change: remove `overflow-hidden` from the `<aside>` className on line 39.

### Files to edit
- `src/components/AppLayout.tsx` (1 line change)

