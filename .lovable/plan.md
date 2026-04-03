
Update the sidebar so labels only appear while the pointer is actually over the sidebar, and the Dashboards submenu only appears while hovering the Dashboards trigger or its menu.

What is happening now:
- The sidebar width is collapsing on mouse leave, but the text elements are rendered conditionally in a way that still lets the portalled menu/hover state keep visible text buttons around.
- The screenshot suggests the nav items are visually floating over the page instead of disappearing with the collapsed sidebar.

Plan:

1. Update `src/components/AppLayout.tsx`
- Make the expanded/collapsed behavior depend strictly on sidebar hover.
- Keep text labels inside a wrapper that is clipped when collapsed, instead of relying only on conditional rendering.
- Add `overflow-hidden` and width/opacity transitions to each label container so text cannot remain visible outside the 56px rail.
- Ensure the Dashboards dropdown only opens when `expanded === true` and the user is hovering that item.
- Close the dropdown immediately on sidebar mouse leave.

2. Tighten the Dashboards trigger behavior
- Prevent the portalled menu from opening while the sidebar is collapsed.
- Keep Joel/Kristina accessible only during active hover on the expanded sidebar.
- Make the trigger area behave like the other nav rows so there is no lingering text panel.

3. Update `src/pages/FlowDiagram.tsx`
- Replace the current navigation note with one that reflects the real behavior:
  - left sidebar expands on hover
  - labels hide again on mouse leave
  - Dashboards submenu is hover-only and closes when leaving the sidebar

Expected result:
- When the mouse leaves the navbar, all text buttons disappear.
- Only the icon rail remains visible.
- Dashboards does not leave behind a floating text panel.
- Joel and Kristina remain available during hover on the expanded sidebar.

Technical details:
```text
collapsed: 56px rail, icons only
hovered sidebar: expands to 200px, labels fade/slide in
mouse leaves sidebar: width collapses, labels clip to zero, dropdown closes
```

Files to edit:
- `src/components/AppLayout.tsx`
- `src/pages/FlowDiagram.tsx`
