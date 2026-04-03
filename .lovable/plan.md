
Fix the Dashboards submenu by moving it out of the sidebar scroll container.

What is actually broken:
- The current submenu is still rendered inside `src/components/AppLayout.tsx` under the `overflow-y-auto` nav list.
- A scroll container with `overflow-y-auto` can still clip absolutely positioned children horizontally, so `z-index` alone will not solve this.
- Do I know what the issue is? Yes. The flyout is trapped inside the scrolling sidebar content, so it cannot reliably render above the conversations page.

Plan:

1. Update `src/components/AppLayout.tsx`
- Replace the custom inline flyout (`absolute left-full top-0`) with a portal-based menu using the existing dropdown primitives from `src/components/ui/dropdown-menu.tsx`.
- Keep the Dashboards item as the visible trigger in the sidebar.
- Open the submenu on hover when the sidebar is expanded, and render the menu to the right with `side="right"` / `align="start"` so it sits above the page content instead of inside the scroll area.
- Keep Joel and Kristina as direct clickable items in that submenu.
- Preserve the collapsed tooltip behavior for Dashboards.
- Remove the old manual flyout block and any hover-gap logic tied to it.
- Optionally raise the sidebar layer slightly (`z-30`) as a safety cleanup, but the real fix is the portal.

2. Update `src/pages/FlowDiagram.tsx`
- Change the navigation note to document that the Dashboards submenu is now rendered via a portal above the content layer, so it is no longer clipped by the sidebar scroll area.

Expected result:
- Hovering Dashboards shows Joel and Kristina fully visible.
- The submenu is clickable and no longer hidden under the conversations page.
- The hover behavior still feels like a quick flyout, not an extra-click menu.

Files to edit:
- `src/components/AppLayout.tsx`
- `src/pages/FlowDiagram.tsx`
