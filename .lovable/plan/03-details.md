## What gets built

**Database** — one migration:
- `public.access_allowlist`: `email` (unique, lowercased), `status` (`pending` | `active` | `revoked`), `user_id`, `note`, `added_by`, `provisioned_at`, `revoked_at`, timestamps.
- GRANTs to `authenticated` / `service_role`, RLS on, all policies `public.has_role(auth.uid(), 'admin')`.
- A validation trigger rejecting any email whose domain is not `lovable.dev`.

**Edge function** — `admin-access-manage` (single function, actions `provision` and `deprovision`):
- Verifies the caller's JWT via the existing `_shared/require-user.ts`, then verifies `has_role(uid,'admin')`; anything else returns 403.
- `provision`: reads the allowlist row, refuses if the row is missing / not `pending` / off-domain, creates the auth user with a random password and confirmed email, writes back `user_id`, `status = active`, `provisioned_at`.
- `deprovision`: deletes the auth user, sets `status = revoked`, `revoked_at`; refuses if the target is the last remaining admin.
- Every call appends a row to the existing audit path so grants and removals are traceable.

**UI** — new `src/components/AccessCard.tsx` mounted in `src/pages/Index.tsx` above `RolesCard`, admin-only like `RolesCard`:
- Table: email, status badge, added, provisioned, actions.
- Add form with inline domain validation; Provision button; Remove access behind an `AlertDialog` confirmation.
- Optional "grant admin on provision" checkbox that inserts into `user_roles` — role management itself stays in `RolesCard`.

**Reconciliation:** on load, the card joins the allowlist against `list_users_with_roles()` and flags two drift cases loudly rather than hiding them — an existing account with no allowlist row ("untracked"), and an `active` row whose account no longer exists ("missing"). The 10 current accounts get backfilled as `active` rows in the migration.

## Verification before I call it done

- Provision one address end-to-end and confirm the account appears in `list_users_with_roles()`.
- Negative cases run and shown: non-admin caller → 403; non-`lovable.dev` email → rejected by both UI and trigger; provisioning an already-active row → refused; deprovisioning the last admin → refused.
- Drift banner exercised against a real untracked account.

## Docs pass (same turn)

`changelog_entries` row, an `access-allowlist` node on `/flow`, and a project-knowledge section staged via `sync-knowledge-pending`.

## Out of scope

No change to signup settings, no change to existing RLS on other tables, no invite emails, no self-service request flow.
