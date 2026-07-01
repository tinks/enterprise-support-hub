# Roles & admin UI (foundation)

Pause the v3 Customer-slices plan. Ship the roles scaffold now so future admin-gated features (starting with `v3_customer_accounts`) have something to check against, and seed matt.niiro@lovable.dev as the first admin.

## Database migration

1. `CREATE TYPE public.app_role AS ENUM ('admin', 'user');`
2. `CREATE TABLE public.user_roles` — `id uuid pk`, `user_id uuid references auth.users(id) on delete cascade not null`, `role app_role not null`, `created_at timestamptz default now()`, `unique (user_id, role)`.
3. Grants: `SELECT` to `authenticated`, `ALL` to `service_role`. No `anon`.
4. Enable RLS.
5. `has_role(_user_id uuid, _role app_role)` — `security definer`, `stable`, `set search_path = public`, returns exists-check against `user_roles`. Standard recursion-safe pattern.
6. Policies on `user_roles`:
   - SELECT: user can read their own rows (`auth.uid() = user_id`) OR `has_role(auth.uid(), 'admin')`.
   - INSERT / UPDATE / DELETE: `has_role(auth.uid(), 'admin')` only.
7. Seed: `INSERT INTO public.user_roles (user_id, role) VALUES ('1d7bf5c8-520b-4a57-9aba-fe3f5e8357b1', 'admin') ON CONFLICT DO NOTHING;` (matt.niiro@lovable.dev, id already verified).

## Client helper

- `src/hooks/useIsAdmin.ts` — TanStack Query hook. Selects from `user_roles` where `user_id = auth.uid() AND role = 'admin'`. Returns `{ isAdmin, isLoading }`. RLS on the SELECT policy already restricts what non-admins see, so this is safe on the client.
- Used to gate admin-only UI. Server-side enforcement always comes from the RLS policies + `has_role()`, never from the client flag.

## Settings → Team → Roles admin UI

New route/section `Settings → Team → Roles` (admin-only; non-admins get a "You don't have access" empty state, and the nav item is hidden via `useIsAdmin`).

Card contents:

- **Members table** — one row per `auth.users` record joined to their `user_roles`. Columns: Email, Roles (badges), Joined, Actions.
  - Data source: a new `list_users_with_roles()` `security definer` SQL function that returns `id, email, created_at, roles text[]` from `auth.users` + `user_roles`. Guarded internally by `has_role(auth.uid(), 'admin')` — raises if the caller isn't an admin. Keeps `auth.users` reads off the client.
- **Grant / revoke admin** — per-row toggle. Writes directly to `user_roles` (INSERT for grant, DELETE for revoke). RLS admin-only policy is the real gate.
- **Guard**: cannot revoke your own `admin` role if you're the last admin. Enforced two ways:
  1. Client: disable the toggle with a tooltip when `roles.filter(admin).count === 1 && row.id === auth.uid()`.
  2. DB: `BEFORE DELETE` trigger on `user_roles` that raises if the delete would leave zero admin rows. Belt-and-suspenders — the DB check is the real guarantee.

No invite/create-user flow in this pass — new users still arrive via existing auth; admins grant them the role after first sign-in.

## Housekeeping

- Update `.lovable/project-knowledge.md` — new "Roles & permissions" section documenting the enum, `user_roles` table, `has_role()` helper, admin-only RLS pattern, last-admin guard, and the Settings → Team → Roles page.
- New memory `mem://features/roles-and-permissions.md` — describes the scaffold and the rule that all future admin-gated tables/features use `has_role(auth.uid(), 'admin')` in RLS rather than checking `user_roles` directly.
- `changelog_entries` row: "Added Roles & permissions with admin UI. matt.niiro@lovable.dev seeded as first admin."
- Leave the v3 Customer-slices plan on hold; when we resume it, the admin RLS on `v3_customer_accounts` will use `has_role()` from this scaffold.

## Verification before shipping

1. Sign in as matt.niiro@lovable.dev → Settings → Team → Roles renders, table lists users, admin badge on your row.
2. Grant admin to a second test user → they can now see the page. Revoke it → their access disappears on next query.
3. Attempt to revoke your own admin while you're the only admin → blocked with clear error (both client tooltip and DB trigger).
4. Sign in as a non-admin → nav item hidden; direct navigation to the route shows the empty state; a manual `insert` into `user_roles` via the client fails on RLS.

## Out of scope

- v3 `customer_key` / `v3_customer_accounts` / customer override UI — paused, resume after this ships.
- Additional roles beyond `admin` / `user`.
- User invite / creation flow.
- Per-feature permission grid (single `admin` role is enough for now).
