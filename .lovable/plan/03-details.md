## Step 0 — feasibility check (before anything is built)

The installed auth package in this project (`@lovable.dev/cloud-auth-js` 1.1.1) exposes only OAuth sign-in; it has no workspace-identity surface, and the public docs page for the feature returned no readable content. So the first action is to upgrade the package and confirm the real API: how the Hub obtains the workspace member's identity, what it returns (email, member id, workspace id), and whether it produces a backend session the existing row-level security can trust — the Hub's access rules are all written against a signed-in user id.

Two outcomes:
- **Usable** — continue with the build below.
- **Not usable here** — I stop and report exactly what was missing; the fallback is the previously planned allowlist plus a one-click Provision button, unchanged.

## What gets built

**Database** — one migration:
- `public.hub_members`: `email` (unique, lowercased), `user_id`, `status` (`active` | `blocked`), `first_seen_at`, `last_seen_at`, `blocked_at`, `blocked_by`, `note`.
- GRANTs to `authenticated` / `service_role`, RLS on; admins read and write all rows, a member may read only their own.
- A trigger rejecting any email whose domain is not `lovable.dev`.
- The 10 existing accounts are backfilled as `active` rows so nothing changes for people already using the Hub.

**Edge function** — `workspace-identity-exchange`:
- Verifies the workspace identity presented by the client, refuses anything that is not a verified `@lovable.dev` workspace member, and refuses a member whose `hub_members` row is `blocked`.
- On success it upserts the `hub_members` row, ensures a backend user exists for that email, and returns a session the app uses like any other sign-in.
- Every provision and block is written to the existing audit path.

**UI**:
- `src/pages/Login.tsx` gains a "Continue as workspace member" path; email/password stays for the accounts that already have it.
- New admin-only `src/components/AccessCard.tsx` in Settings, above `RolesCard`: table of members (email, status, first seen, last seen, roles), Block behind an `AlertDialog` confirm, Unblock, and a link across to `RolesCard` for admin grants.
- Drift is shown, not hidden: a backend account with no `hub_members` row is flagged "untracked", and a `blocked` row whose account still exists is flagged "not yet enforced".

## Verification before I call it done

- One real workspace member signs in with no pre-existing account and lands in the Hub; their row appears `active`.
- Negative cases run and shown: blocked member refused at exchange; a non-`lovable.dev` identity refused; a non-admin calling the exchange with someone else's identity refused; existing email/password sign-in still works.
- Last-admin guard still refuses a block that would leave zero admins.

## Docs pass (same turn)

`changelog_entries` row, a `workspace-identity` node on `/flow`, and a project-knowledge section staged via `sync-knowledge-pending`.

## Out of scope

No change to the signup setting (stays closed), no change to existing RLS on data tables, no invite emails, no self-service access request flow.
