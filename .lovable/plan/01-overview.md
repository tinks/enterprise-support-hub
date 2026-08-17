# Merge Access + Roles into one Users table

I agree — condense them. The two cards are not two datasets; they are the same two queries rendered twice.

- `AccessCard` loads `hub_members` **and** `list_users_with_roles`, and already renders a **Roles** column.
- `RolesCard` loads `list_users_with_roles` only, and renders email / roles / joined plus three buttons.

So the second table exists purely to host **Grant editor**, **Make read-only**, **Grant admin**, **Revoke admin**. Those belong on the roster row for the same person.

One risk to keep, not drop: the two tables are keyed differently. The roster is keyed by email in `hub_members`; roles are keyed by `auth.users.id`. When those disagree the current Access card surfaces it as the amber **Roster drift** banner. The merged table must keep showing both drift cases as real rows, or a person with an account but no roster row would silently vanish from the only Users surface.

## What the single table looks like

One row per person, unioned by email:

| Email | Status | Roles | Added | Provisioned | Actions |

- **Status** — `pending`, `active`, `blocked` from the roster; plus a new `untracked` badge for an auth account that has no roster row.
- **Roles** — badges as today.
- **Actions** — access actions (Provision / Unblock / Remove access) and role actions (Grant editor / Make read-only / Grant admin / Revoke admin) in one cell. Role actions are disabled with a tooltip when the row has no backend account yet, since there is no `user_id` to attach a role to.
- The amber drift banner stays, but now names rows you can see and act on rather than rows that only exist in prose.

## What does not change

`hub_members`, `user_roles`, `list_users_with_roles`, `has_role`, `can_edit`, `hub-access-manage`, the last-admin trigger, and every RLS policy stay exactly as they are. This is a presentation merge only.
