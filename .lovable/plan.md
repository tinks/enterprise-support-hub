

## Fix all tooltip labels showing at once when sidebar is collapsed

### Problem
The screenshot shows every nav item's tooltip (Stats, Conversations, Import, Settings, Flow, Knowledge) appearing simultaneously when the sidebar is collapsed. This happens because all `Tooltip` components share a single `TooltipProvider` with `delayDuration={0}`. Radix UI's tooltip provider has a "skip delay" feature — once one tooltip opens, subsequent tooltips in the same provider open instantly. Combined with `delayDuration={0}`, this can cause multiple tooltips to appear at once.

### Fix

**`src/components/AppLayout.tsx`**

Wrap each `Tooltip` in its own `TooltipProvider` instead of having one shared provider around all items. This isolates each tooltip so only the one being hovered appears.

Change from:
```tsx
<TooltipProvider delayDuration={0}>
  {navItems.slice(0, 2).map(...)}
  {/* Dashboards */}
  {navItems.slice(2).map(...)}
</TooltipProvider>
```

To: remove the outer `TooltipProvider` and wrap each individual `Tooltip` with its own `TooltipProvider delayDuration={0}`.

### Files to edit
- `src/components/AppLayout.tsx`

