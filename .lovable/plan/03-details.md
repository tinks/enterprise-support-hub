## Technical detail

**New file** `src/pages/Users.tsx`
- Wraps `AppLayout`, header "Users" with a one-line description ("Who can sign in to the Hub, and who has admin.").
- Renders `<AccessCard />` then `<RolesCard />` unchanged.
- Reads `useIsAdmin()`: while loading, a skeleton; if not admin, a single card saying admin access is required (otherwise both cards self-hide and the page looks broken).

**`src/App.tsx`** — add `<Route path="/users" element={<ProtectedRoute><Users /></ProtectedRoute>} />`.

**`src/components/AppLayout.tsx`** — in the Admin group's `items`, add `{ to: "/users", label: "Users", adminOnly: true }`, placed above `Settings`.

**`src/pages/Index.tsx`** — delete lines 410 and 412 (`<AccessCard />`, `<RolesCard />`) and their two imports. Optionally leave a short pointer card ("User access moved to Admin → Users") matching the existing Customer accounts pointer card pattern; say the word if you'd rather have a clean removal with no pointer.

**Untouched:** `AccessCard.tsx`, `RolesCard.tsx`, `hub-access-manage`, all SQL, RLS, and RPCs.

## Docs pass (same turn)

- `changelog_entries` row for the move.
- `src/pages/FlowDiagram.tsx`: update the existing `hub-access-roster` node's surface reference from Settings to `/users`.
- `.lovable/project-knowledge.md` section updated and staged via `sync-knowledge-pending` (pending review, never live).

## Verification

- Playwright at a wide viewport: `/users` renders both cards; `/settings` no longer shows them; the Admin group shows the Users entry.
- Non-admin branch checked by asserting the gate renders the "admin required" state rather than a blank page.
