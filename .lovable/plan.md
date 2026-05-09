## Goal

Inbox filters should survive navigating into a conversation and back. They should only clear when the user clicks an explicit Reset filters button.

## Current state

Most filters already persist to `localStorage` and rehydrate on mount: `sourceFilter`, `ownerFilter`, `productAreaFilter`, `classificationFilter`, `hiddenStatuses`, and `columnOrder`. There is also a `resetAll()` function and a `Reset` button — but the button lives inside the collapsible Filter panel, so it's easy to miss, and it does not clear the localStorage entries it leaves behind.

Two filter inputs do NOT persist today:
- `searchQuery`
- `dateFrom` / `dateTo`

So when you go to a conversation and hit Back, the search box and the date range are lost.

## Changes (all in `src/pages/Conversations.tsx`)

1. **Persist `searchQuery`**
   - Initialize `useState` from `localStorage.getItem("conv-search")`.
   - Add a `useEffect` that writes `searchQuery` to `localStorage` on change (empty string clears the key).

2. **Persist `dateFrom` / `dateTo`**
   - Initialize from `localStorage.getItem("conv-date-from") / "conv-date-to"` (parse ISO strings to `Date`).
   - Add `useEffect`s that write them on change (or remove the key when undefined).

3. **Make `resetAll` actually reset everything**
   - Also clear `searchQuery`, `dateFrom`, `dateTo`.
   - Explicitly `localStorage.removeItem(...)` for every persisted key (`conv-source-filter`, `conv-owner-filter`, `conv-pa-filter`, `conv-class-filter`, `conv-hidden-statuses`, `conv-search`, `conv-date-from`, `conv-date-to`, plus the column order keys). The existing per-state `useEffect`s will then re-write the cleared defaults, which is fine.
   - Update `anyFilterActive` to also consider `searchQuery.length > 0`.

4. **Surface a top-level Reset filters button**
   - Add a `Reset filters` button (`RotateCcw` icon, ghost/outline) to the always-visible Search & Refresh bar (around line 1730), shown only when `anyFilterActive` is true.
   - Keep the existing one inside the Filter accordion as-is so both entry points work.

## Out of scope

- Persisting query-string driven filters (`paramDay`, `paramHour`, `paramChannel`, etc.) — those are link-driven, not user filters.
- Persisting expanded gmail groups or expanded message previews.
- Cross-tab sync.
