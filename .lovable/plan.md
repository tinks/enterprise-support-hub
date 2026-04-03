
## Fix the dashboards flyout so it renders above the page

### Likely root cause
The previous fix removed clipping from the sidebar itself, but the flyout is still rendered inside the sidebar’s scroll container (`nav`), which uses `overflow-y-auto`. That can still clip or bury horizontal overflow. There is also a small hover gap (`ml-1`) that can make the submenu hard to reach.

### What to change

**`src/components/AppLayout.tsx`**
- Keep the sidebar/flyout layer above the page by giving the sidebar a stacking context, e.g. `relative z-20`
- Stop using the same element for both:
  1. vertical scrolling, and
  2. flyout rendering
- Change the sidebar structure so:
  - the outer sidebar/nav wrapper is `overflow-visible`
  - an inner wrapper handles `overflow-y-auto` for the regular links
- Keep the Dashboards flyout rendered from a `relative` parent, but ensure the submenu itself is:
  - `absolute left-full top-0`
  - high z-index
  - not clipped by any parent
- Remove the hover dead-zone by eliminating the submenu gap (`ml-1`) or replacing it with a hover-safe approach so the cursor can move directly from “Dashboards” into Joel/Kristina

### Suggested structure
```text
aside (relative, z-20, overflow-visible)
  nav (relative, overflow-visible)
    inner scroll list (overflow-y-auto)
      Stats
      Conversations
      Dashboards trigger
      Import
      Settings
      Flow
      Knowledge
    Dashboards flyout (absolute, outside scroll clipping)
```

### Expected result
- The flyout appears on top of the main page content
- Joel and Kristina are fully visible
- The submenu stays open while moving the mouse from “Dashboards” to the submenu
- Clicking Joel or Kristina works reliably

### Documentation
**`src/pages/FlowDiagram.tsx`**
- Update the navigation notes to reflect that the Dashboards flyout now renders above the content layer and is no longer clipped by the sidebar scroll area

### Files to edit
- `src/components/AppLayout.tsx`
- `src/pages/FlowDiagram.tsx`
