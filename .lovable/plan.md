
## Fix the Dashboards hover menu so Joel and Kristina stay visible

### What is actually broken
The Dashboards submenu is now portalled outside the sidebar, which solved clipping, but the sidebar still closes itself on the sidebar’s `onMouseLeave`. As soon as the mouse moves from the sidebar into the portalled menu, the app treats that as “left the navbar”, so the sidebar collapses and the Joel/Kristina menu disappears.

### Plan

**`src/components/AppLayout.tsx`**
- Replace the current “close everything on sidebar mouse leave” behavior with coordinated hover state.
- Track hover separately for:
  - the sidebar rail
  - the Dashboards trigger row
  - the portalled Dashboards menu content
- Derive visibility from those states:
  - sidebar stays expanded while hovering the sidebar or the Dashboards menu
  - Dashboards menu stays open while hovering the trigger or the menu itself
- Remove the current immediate `handleMouseLeave` collapse logic that closes the menu too early.
- Keep nav labels clipped when fully collapsed so no floating text remains once the pointer leaves both the sidebar and the menu.
- Tighten the flyout positioning by removing the hover gap (`sideOffset={0}` or equivalent), so moving from “Dashboards” to Joel/Kristina is seamless.
- Keep tooltip behavior only for the collapsed icon-only state.

### Result
- Hovering the sidebar expands it.
- Hovering Dashboards shows Joel and Kristina.
- Moving the mouse from the sidebar into the Joel/Kristina menu does not make it disappear.
- When the mouse leaves both the sidebar and the submenu, everything collapses and all text hides again.

### Flow page update
**`src/pages/FlowDiagram.tsx`**
- Update the navigation note so it reflects the real behavior:
  - left sidebar expands on hover
  - Dashboards submenu is hover-driven
  - submenu remains open while moving into Joel/Kristina
  - everything hides once the pointer leaves both areas

### Files to edit
- `src/components/AppLayout.tsx`
- `src/pages/FlowDiagram.tsx`
