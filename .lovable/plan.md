# Drive the Dashboards flyout from the Teammates roster

Decision: yes, it makes sense — but only if the flyout keeps a real on/off switch rather than blindly listing everyone.

## Why

Today the Dashboards list is a hardcoded array in `src/components/AppLayout.tsx` (`/my/joel`, `/my/kristina`, `/my/tine`, `/my/eren`, `/my/matt`). Meanwhile `public.teammates` already is the canonical roster (name, email, `intercom_admin_id`, `role`, `active`) and already drives the Backlog assignee dropdown and the SLA support roster. Two lists of people, one of them invisible to admins, drifting apart.

But "every teammate gets a dashboard" is the wrong rule: the roster contains `role = 'ai'` (Sam) and `other` entries that should never appear, and someone may want a roster entry without a nav link. So the roster supplies *who exists*, and a new explicit flag supplies *who gets a dashboard*.

## What to build

1. Add a `show_dashboard boolean not null default false` column to `public.teammates`. Backfill `true` for the five names currently in the flyout (Joel, Kristina, Tine, Eren, Matt).
2. In the Teammates panel (`src/components/AdminMappingCard.tsx`), add a "Dashboard" toggle per row, next to the existing Active switch. Admin-gated the same way the rest of the panel is. Disabled for `role = 'ai'` rows so Sam can never be toggled on.
3. In `AppLayout.tsx`, replace the hardcoded `/my/*` children with a small hook that loads `teammates WHERE active AND show_dashboard AND role <> 'ai'`, ordered by name, and maps each to `{ to: "/my/" + name.toLowerCase(), label: name }`. The static `/sla` entry stays pinned at the top of the group.
4. Loading/failure behavior: while loading, render the group with just `/sla`; if the query fails, fall back to the current hardcoded five so the nav never goes empty.

## Explicitly out of scope

- `OWNER_OPTIONS` in `Conversations.tsx`, `ConversationDetail.tsx`, `TestChannelReview.tsx` and `OWNER_MAP` in `BulkImportReview.tsx` stay hardcoded. Those lists include non-teammate owners (`CSM`, `Sam`) and are used for filtering historical data, so repointing them is a separate, riskier pass.
- No change to `settings.admin_owner_map` dual-write, owner attribution, or SLA roster logic.
- `/my/:owner` stays a live route for any name, including names not in the flyout. Nothing is access-controlled here — this is nav curation, not permissions.

## Technical notes

- `OwnerDashboard.tsx` capitalizes the URL segment and passes it as `forceOwner` to `Conversations`, matched against the `owner` column. So the label in the flyout must match the stored owner string exactly. `teammates.name` currently holds short names ("Tine", not "Tine Saint-Ghislain"), which matches; `normalizeOwner()` already handles the long-form stragglers in data.
- Migration includes the column add plus the backfill UPDATE. No new table, so no new GRANT/RLS block is needed — existing `teammates` policies apply.
- Adding a person after this ships = one toggle in Settings, no code change.

## Follow-ups worth doing later, not now

- Unify `OWNER_OPTIONS` onto the roster (needs a decision on how `CSM` and `Sam` are represented).
- A per-teammate dashboard sort order, if the alphabetical list gets long.
