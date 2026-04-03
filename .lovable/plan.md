

## Fix "Dashb" text leaking when sidebar is collapsed

### Problem
When a dashboard route is active (e.g. `/my/kristina`), the Dashboards row has `isDashboardActive` which applies `activeClass` (a background highlight). The sidebar is collapsed to 56px, but the "Dashboards" label text inside the `<span>` still renders — the `labelClass` uses `w-0 opacity-0` but `whitespace-nowrap` on the parent `linkBase` prevents the text from being clipped, causing "Dashb" to leak out visually.

### Fix

**`src/components/AppLayout.tsx`**

On the Dashboards trigger div (line 94), the `linkBase` class includes `whitespace-nowrap`. When collapsed, the label span has `w-0 opacity-0` but the text still overflows because the parent div doesn't clip it. Add `overflow-hidden` to the Dashboards trigger div so the label text is properly clipped when the sidebar is collapsed.

Change line 94 from:
```tsx
className={`${linkBase} cursor-pointer relative ${isDashboardActive ? activeClass : ""}`}
```
to:
```tsx
className={`${linkBase} cursor-pointer relative overflow-hidden ${isDashboardActive ? activeClass : ""}`}
```

Also apply the same `overflow-hidden` to all NavLink wrappers (lines 81, 108) for consistency — though they may not exhibit the issue currently, it's defensive.

### Files to edit
- `src/components/AppLayout.tsx` (1 line change, line 94)

