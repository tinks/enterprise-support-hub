## Goal

On dashboard views (`/my/<owner>`), make these the defaults so the page loads clean with no "active filters" badge:
- **Owner** = the dashboard's owner (already enforced via `forceOwner`)
- **Status** = hide only `resolved` (everything else visible)
- All other filters (Source, Product area, Classification, Date) = All / cleared

The inbox view (`/conversations`) keeps its current defaults unchanged (hides `test`, `cancelled`, `resolved`; persists user picks in localStorage).

## Changes (all in `src/pages/Conversations.tsx`)

1. **Context-aware defaults**
   - Introduce `DASHBOARD_HIDDEN = new Set(["resolved"])` alongside the existing `DEFAULT_HIDDEN`.
   - Compute `effectiveDefaultHidden = forceOwner ? DASHBOARD_HIDDEN : DEFAULT_HIDDEN`.
   - Initial `hiddenStatuses`: on dashboards, ignore the shared `conv-hidden-statuses` localStorage and start from `DASHBOARD_HIDDEN`. On inbox, behave as today.
   - `hiddenDiffersFromDefault` compares against `effectiveDefaultHidden`.
   - The Status popover "Restore defaults" button resets to `effectiveDefaultHidden`.

2. **Don't pollute inbox storage from dashboards**
   - Skip the `localStorage.setItem("conv-hidden-statuses", …)` effect when `forceOwner` is set, so toggling status while on a dashboard doesn't change the inbox default. (Same pattern already used for owner filter.)
   - Same skip for `conv-pa-filter` and `conv-class-filter` writes when `forceOwner` is set, so dashboard tinkering doesn't leak into the inbox.

3. **Active-filter count on dashboards**
   - Don't count `ownerFilter` when `forceOwner` is set (it's the view, not a filter).
   - `hiddenDiffersFromDefault` now compares to dashboard default, so hiding only `resolved` reads as 0.
   - Net effect: a freshly opened `/my/kristina` shows no "active" badge.

4. **Reset behaviour**
   - On dashboards, `resetAll` resets `hiddenStatuses` to `DASHBOARD_HIDDEN` (instead of `DEFAULT_HIDDEN`), keeps the forced owner, and clears Source/Product area/Classification/Date as today.
   - On inbox, unchanged.

5. **Switching between dashboards** already remounts via `key={ownerName}` in `OwnerDashboard`, so each dashboard initialises with its own defaults — no extra work needed.

## Out of scope

- No changes to data fetching, RLS, edge functions, or the Flow page logic.
- No changes to column-header filters or table layout.
- Inbox (`/conversations`) defaults and persistence remain exactly as they are.

## Verification

- Open `/my/kristina` fresh → Owner chip = Kristina, Status shows "1 hidden" tooltip-wise but Filters header shows **no "active" badge** (it equals dashboard default). Rows exclude resolved only.
- Toggle Source = Slack → badge shows "1 active". Click Reset → back to clean dashboard defaults, owner stays Kristina.
- Switch to `/my/joel` → reloads with Joel + hide-resolved, no active badge.
- Open `/conversations` → unchanged: hides test/cancelled/resolved by default, owner = All (or last saved), persistence intact.