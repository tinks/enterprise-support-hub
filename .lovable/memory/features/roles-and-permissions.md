---
name: Roles & permissions
description: app_role enum + user_roles table + has_role() helper + Settings roles UI; canonical pattern for all admin-gated features
type: feature
---

## Scaffold
- Enum `public.app_role` with values `admin`, `user`
- Table `public.user_roles (id, user_id → auth.users, role, created_at)` with `UNIQUE (user_id, role)`
- Security-definer function `public.has_role(_user_id uuid, _role app_role) → boolean`
- RPC `public.list_users_with_roles()` (admin-only, security definer) — used by the Settings UI so the client never queries `auth.users`

## RLS pattern (canonical — reuse everywhere)
For any future admin-gated write path, RLS policies MUST use:
```sql
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'))
```
Never inline a `SELECT ... FROM user_roles` inside a policy — it causes infinite recursion when the policy is on `user_roles` itself, and duplicates logic elsewhere.

## Last-admin guard
`BEFORE DELETE` trigger `user_roles_prevent_last_admin_delete` raises if the delete would leave zero admins. The UI also disables the revoke button with a tooltip when applicable, but the DB trigger is the real guarantee.

## Client
- Hook `src/hooks/useIsAdmin.ts` — UI gating only
- Card `src/components/RolesCard.tsx` — mounted in `src/pages/Index.tsx` (Settings). Renders nothing for non-admins.

## Seeded admin
`matt.niiro@lovable.dev` (auth uid `1d7bf5c8-520b-4a57-9aba-fe3f5e8357b1`) is the first admin, added in the initial roles migration.
