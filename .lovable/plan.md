

## Replace top navbar with a left sidebar (auto-expand on hover)

### What it does
Replaces the current horizontal top navigation bar with a vertical sidebar on the left side of the page. The sidebar shows only icons when collapsed (narrow ~56px strip) and smoothly expands to show full labels when you hover over it. When the mouse leaves, it collapses back to icons-only. This frees up vertical space for the conversations table and feels more modern for a dashboard app.

### Layout change

```text
BEFORE:                          AFTER:
┌──────────────────────┐         ┌───┬──────────────────┐
│  Stats │ Conv │ Joel │         │ 📊│                  │
├──────────────────────┤         │ 💬│   Main content    │
│                      │         │ 👤│                  │
│   Main content       │         │ 👤│                  │
│                      │         │ 📥│                  │
│                      │         │ ⚙️│                  │
└──────────────────────┘         └───┴──────────────────┘
                                  ↑ expands on hover
```

### Behaviour
- **Collapsed (default)**: ~56px wide, shows icons only, with a tooltip on hover per item
- **Expanded (on mouse enter)**: ~200px wide, shows icon + label, smooth CSS transition (~200ms)
- **Collapses on mouse leave**: returns to icon-only state
- The gradient accent line moves from horizontal (top) to vertical (left edge of sidebar)
- Logo icon always visible; app title only shown when expanded

### Changes

**`src/components/AppLayout.tsx`**
- Replace the horizontal `<nav>` with a vertical sidebar `<aside>` on the left
- Add `useState` for `expanded` state, toggled by `onMouseEnter`/`onMouseLeave`
- Layout becomes `flex flex-row` instead of `flex flex-col`
- Each nav link stacks vertically; label text hidden when collapsed via `overflow-hidden` + width transition
- Active route highlighted with left border accent or background
- Gradient accent bar becomes a thin vertical strip on the left edge of the sidebar

**`src/pages/FlowDiagram.tsx`**
- Document the navigation layout change from top bar to collapsible left sidebar

### Files to edit
- `src/components/AppLayout.tsx`
- `src/pages/FlowDiagram.tsx`

