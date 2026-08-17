# Move Access + Roles onto their own Admin → Users page

I agree with the split. Today the Settings page mixes two unrelated jobs: integration configuration (Slack/Intercom tokens, product areas, admin mappings, sync cards) and people management (who can sign in, who is an admin). They have different audiences, different change cadence, and both people cards already render nothing for non-admins — so on Settings they are invisible dead space for most users.

## What changes

- New route `/users` rendering a page titled "Users" with two sections: **Access** (the roster) and **Roles & permissions**.
- Nav: add `Users` under the **Admin** group, marked `adminOnly` so it hides for non-admins (same treatment as SLA Policy).
- Settings: remove `<AccessCard />` and `<RolesCard />`, leaving integration configuration only.
- The two components move as-is — no behavior, query, RLS, or edge-function change.

## What stays the same

- `hub_members`, `user_roles`, `list_users_with_roles`, `hub-access-manage`, the last-admin trigger, and the roster-drift banner all stay untouched.
- Admin gating still comes from `useIsAdmin` inside each card plus the RLS/edge-function checks; the page just adds a non-admin empty state so the route isn't a blank screen if someone lands on it.
