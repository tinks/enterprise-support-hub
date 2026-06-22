Add user-resizable columns to the Inbox v2 table (`src/pages/InboxV2.tsx`).

## Approach

Replace the current fixed-width `TableHead` widths with a resizable column system using `@tanstack/react-table`'s column sizing API (already a dependency via react-query's ecosystem — will add `@tanstack/react-table` if not present).

Simpler alternative (preferred): implement a lightweight custom resize handler — no new dependency.

- Track column widths in component state, seeded from current defaults (Subject: flex, Contact: 180, Owner: 120, Product area: 160, Classification: 140, Status: 90, Updated: 140).
- Render each `TableHead` with an absolutely-positioned 4px drag handle on its right edge (`cursor-col-resize`, hover highlight).
- On `mousedown`, capture starting X and width; on `mousemove`, update width (min 60px); on `mouseup`, release listeners.
- Apply widths via inline `style={{ width }}` on both `<th>` and matching `<td>` (use `table-layout: fixed` on the `<table>` so widths are respected).
- Persist widths to `localStorage` under `inbox-v2-col-widths` so the user's layout survives reloads.

## Scope

- Only `src/pages/InboxV2.tsx` changes.
- No changes to data, filters, sync logic, or other pages.
- No new dependencies.

## Out of scope

- Column reordering or show/hide.
- Applying the same treatment to other tables (Conversations, etc.) — can follow if you like it here first.
