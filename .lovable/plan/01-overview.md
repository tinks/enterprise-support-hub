# Read-only access for CSMs

Today every signed-in account can write. Verified: 11 auth accounts, 2 role rows (both `admin`), and 32 live write policies in `public` that only require `authenticated` — so a CSM signing in today can edit tickets, notes, settings, backlog, and the registry.

The fix is a deny-by-default **editor** role. Writing requires `editor` or `admin`; an account with no role row can read but cannot change anything. New members are safe on day one without anyone remembering to restrict them.

## What changes

- New enum value `editor` on `app_role`, alongside `admin` and `user`.
- Every non-admin write policy in `public` moves from "any authenticated user" to `has_role(auth.uid(), 'editor') OR has_role(auth.uid(), 'admin')`. Reads are untouched — CSMs still see all reports.
- Backfill: the 9 non-admin existing accounts get `editor` so nothing changes for today's team. Admins keep implicit write access.
- Edge functions that write (`esh-write-action`, `post-reply`, and the other user-invoked mutators) reject non-editors server-side with 403, so hidden buttons aren't the only defence.
- UI: a `useCanEdit()` hook mirrors the rule. Write controls hide or disable for read-only users, and the operational, write-only pages (Triage, Dev escalations, Backlog, Import, Flow, Knowledge) drop out of their nav, leaving reports, analytics, insights, customers, and the inbox views.
- The Users page (Admin → Users) gains an Editor column and grant/revoke buttons next to the existing admin ones.

## What is deliberately not changed

- `v3_derive_customer`, sync/cron edge functions, and anything authenticating with the anon key. Cron paths carry no user JWT, so they run as service role and are not affected by the new policies — this is checked per function before the migration ships.
- No read policy is narrowed. If a CSM can see a page today, they can still see it.
