## Technical detail

**`src/components/AccessCard.tsx` becomes the single `UsersCard`** (rename the file to `src/components/UsersCard.tsx`; title "Users", description covering both jobs).

- Keep the existing `load()` — it already fetches `hub_members` and `list_users_with_roles` in parallel.
- Build the rendered list as a union: every `hub_members` row, plus a synthetic row for each auth account whose email has no roster row (`status: "untracked"`, `user_id` from the auth row, `provisioned_at: null`, `created_at` from the auth row).
- Sort by email.
- Lift the role mutations from `RolesCard` verbatim: `setRole(userId, "admin" | "editor", grant)` writing to `user_roles`, then `load()`.
- `adminCount` computed from the auth-users list (unchanged semantics); keep the last-admin tooltip and the disabled Revoke admin button.
- Role buttons render only when `m.user_id` is non-null and present in `authIds`; otherwise show a muted "no account yet" hint in the actions cell.
- Actions cell: wrap in a `flex flex-wrap justify-end gap-2` so access and role buttons coexist without breaking the row at narrower widths.
- Keep the drift banner, but reword it — untracked accounts are now visible rows, so the banner is a count plus a pointer, and the "active row with no backend account" case stays as-is.

**`src/pages/Users.tsx`** — render one `<UsersCard />` instead of `<AccessCard />` + `<RolesCard />`. Admin gate and skeleton unchanged.

**`src/components/RolesCard.tsx`** — delete. Confirm no other import first (it was already removed from `src/pages/Index.tsx`).

**Untouched:** all SQL, RLS, RPCs, `hub-access-manage`, `useIsAdmin`, `useCanEdit`.

## Docs pass (same turn)

- `changelog_entries` row for the merge.
- `src/pages/FlowDiagram.tsx`: update the `hub-access-roster` and `role-permissions` nodes to name one Users table rather than two cards.
- `.lovable/project-knowledge.md` and `.lovable/memory/features/roles-and-permissions.md` updated; knowledge staged via `sync-knowledge-pending` (pending review, never live).

## Verification

- Playwright at 1900px on `/users`: one table, all 11 accounts present, roles badges correct, and the actions cell showing both access and role buttons on an active row.
- Negative cases shown, not assumed: a `pending` row renders role buttons disabled; the sole-admin row renders Revoke admin disabled with its tooltip.
- Cross-check the rendered row count against `hub_members` + untracked auth accounts by SQL before claiming it's correct.
