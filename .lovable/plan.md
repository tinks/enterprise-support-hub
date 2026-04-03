

## Add "Dashboards" flyout group to the sidebar nav

### What it does
Replaces the two separate Joel and Kristina nav items with a single "Dashboards" item that, when hovered (in expanded mode), reveals a flyout submenu showing Joel and Kristina as clickable links. This keeps the sidebar clean and requires zero extra clicks — just hover to expand the sidebar, hover on "Dashboards", and click the person.

### Behaviour

```text
Collapsed:                 Expanded + hover on Dashboards:
┌────┐                     ┌──────────────────┐
│ 📊 │                     │ 📊 Stats         │
│ 💬 │                     │ 💬 Conversations │
│ 👥 │ ← tooltip:          │ 👥 Dashboards  ▸ │──┐
│ 📥 │   "Dashboards"      │ 📥 Import        │  │ Joel
│ ⚙️ │                     │ ⚙️ Settings      │  │ Kristina
│ 🔀 │                     │ 🔀 Flow          │  └──────────┘
│ 📖 │                     │ 📖 Knowledge     │
└────┘                     └──────────────────┘
```

- **Collapsed**: Shows a Users icon; tooltip says "Dashboards"
- **Expanded**: Shows "Dashboards" label; on hover a small flyout panel appears to the right with Joel and Kristina as links
- **Single interaction**: hover sidebar → hover Dashboards → click name (no extra clicks needed)
- Active state: if you're on `/my/joel` or `/my/kristina`, the Dashboards item highlights

### Changes

**`src/components/AppLayout.tsx`**
- Remove Joel and Kristina from the flat `navItems` array
- Add a `Users` icon import from lucide-react
- After the Conversations nav item, render a "Dashboards" group item with:
  - A `relative` wrapper with `onMouseEnter`/`onMouseLeave` state for the flyout
  - The parent item shows the Users icon + "Dashboards" label (when expanded)
  - On hover, an absolutely-positioned flyout (`left-full top-0`) appears with two `NavLink` entries for Joel and Kristina
  - When sidebar is collapsed, tooltip shows "Dashboards"; when expanded, the flyout replaces the tooltip
- Style the flyout with `bg-popover border rounded-md shadow-md p-1` to match the app's design system

**`src/pages/FlowDiagram.tsx`**
- Document the nav restructure: Joel/Kristina moved under a Dashboards flyout group

### Files to edit
- `src/components/AppLayout.tsx`
- `src/pages/FlowDiagram.tsx`

