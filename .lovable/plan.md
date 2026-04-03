
## Fix the collapsed sidebar labels/tooltips so only the intended item is visible

### What is actually happening
The current fix did not fully solve the issue because `src/components/AppLayout.tsx` still has two weak points:

1. Only the Dashboards row has `overflow-hidden`, so other nav rows can still visually leak text when collapsed.
2. The collapsed-label tooltips still rely on Radix’s automatic hover behavior. Even with separate providers, that can still leave multiple tooltip labels visible during hover/collapse transitions.

### Plan

**`src/components/AppLayout.tsx`**

1. Make label clipping consistent for every nav row:
   - Move `overflow-hidden` into the shared `linkBase` (or otherwise apply it to all `NavLink` rows, not just Dashboards).
   - Optionally tighten the label animation by using a bounded width transition (`max-w-*`) instead of `w-auto`, so collapsed text cannot bleed or flicker.

2. Replace the current “uncontrolled tooltip per item” behavior with one controlled sidebar tooltip state:
   - Add a single `activeTooltip` state for the collapsed rail.
   - On hover of a nav item, set `activeTooltip` to that item’s key.
   - On leave, clear it.
   - Render each tooltip with controlled `open` logic so only one can ever be visible at a time.

3. Make tooltips and flyout cooperate cleanly:
   - Clear `activeTooltip` whenever the sidebar expands.
   - Clear it when the Dashboards flyout opens, when navigating to Joel/Kristina, and on sidebar mouse leave.
   - Keep the existing Dashboards flyout hover behavior intact.

4. Keep the Dashboards submenu behavior as-is:
   - Joel and Kristina stay visible while hovering Dashboards/flyout.
   - All text disappears once the pointer leaves both the sidebar and the flyout.

**`src/pages/FlowDiagram.tsx`**
- Update the navigation note so it reflects the real behavior:
  - left sidebar expands on hover
  - labels are clipped cleanly when collapsed
  - collapsed sidebar shows only one tooltip at a time
  - Dashboards flyout remains visible only while hovering Dashboards or its submenu

### Why this approach
The earlier tooltip-provider change targeted the wrong layer. The more reliable fix is:
- clip all row contents at the row level, and
- explicitly control which collapsed tooltip is open.

That addresses both possible symptoms: leaked text and multiple visible labels.

### Files to edit
- `src/components/AppLayout.tsx`
- `src/pages/FlowDiagram.tsx`
