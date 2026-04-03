

## Fix Dashboards flyout staying visible during hover

### Problem
When the mouse moves from the sidebar's "Dashboards" row to the flyout menu, the sidebar's `onMouseLeave` fires and immediately sets `dashboardHovered = false`. Since `menuHovered` hasn't become `true` yet (the mouse is crossing the gap), `dashboardOpen` becomes `false`, the flyout unmounts, and you can never reach Joel/Kristina.

### Fix

**`src/components/AppLayout.tsx`**

1. Stop clearing `dashboardHovered` in the sidebar's `onMouseLeave` — only clear `sidebarHovered` there. The Dashboards trigger's own `onMouseLeave` already handles `dashboardHovered`.

2. Add a small debounce (~100ms) to closing the flyout: instead of deriving `dashboardOpen` directly, use a `useEffect` with a timeout so the menu stays mounted long enough for the mouse to reach the flyout and set `menuHovered = true`.

3. Bridge the gap: set `sideOffset={0}` (or `left: sidebarWidth` without the `+2`) on the flyout so there's no dead zone between the sidebar edge and the menu.

Concretely:
- Remove `setDashboardHovered(false)` from the sidebar's `onMouseLeave` (line 53)
- Add a `useEffect` that watches `dashboardHovered || menuHovered` and only sets a `dashboardVisible` state to `false` after a 150ms delay (cancelled if re-entered)
- Use `dashboardVisible` for rendering the flyout
- Change flyout `left` from `sidebarWidth + 2` to `sidebarWidth` to eliminate the gap

**`src/pages/FlowDiagram.tsx`**
- Update navigation notes to reflect debounced flyout behavior

### Result
- Hovering "Dashboards" shows Joel and Kristina
- Moving to the flyout keeps it visible
- Moving away from both sidebar and flyout closes everything
- Clicking Joel or Kristina navigates and closes the menu

### Files to edit
- `src/components/AppLayout.tsx`
- `src/pages/FlowDiagram.tsx`

