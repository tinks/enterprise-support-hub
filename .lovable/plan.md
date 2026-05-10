## Problem

Clicking "Unassigned · 21" in Insights → Owner load opens Conversations with the right `owner=unassigned&from=…&to=…` filter, but the table is empty.

Two reasons the counts don't agree:

1. **Status filter** — Conversations hides `test`, `cancelled`, and `resolved` by default. The Insights Owner load count includes all of those. Most of the 21 unassigned tickets in April are likely resolved/cancelled, so they get filtered out.
2. **Gmail date field** — Conversations filters Gmail by `received_at`, while `useMonthData` uses `created_at`. Usually identical, but can differ for backfilled rows.

## Changes

**1. `src/pages/Conversations.tsx` — honor a `showAll` deep-link signal**

- Read `const paramShowAll = searchParams.get("showAll") === "1"`.
- When `paramShowAll` is true on first render, initialize `hiddenStatuses` to an empty Set instead of `DEFAULT_HIDDEN` (and skip writing to localStorage so it doesn't stick after the user leaves).

**2. `src/pages/Conversations.tsx` — align Gmail date field with the report**

In the date-range query block (around lines 713–724), filter Gmail by `created_at` instead of `received_at` so the count matches `useMonthData`.

**3. `src/pages/insights/ReportTab.tsx` — add `showAll=1` to Owner load links**

Append `&showAll=1` to the href built for each Owner load row, so the Conversations view loads with no status filters hidden.

## Result

Clicking "Unassigned · 21" lands on Conversations with all 21 rows visible (including resolved/cancelled), filtered to the month, ready for reassignment.

## Out of scope

- Existing Conversations entry points (sidebar, dashboard owner pages) keep their current default-hidden behavior — only the Insights deep-link opts into showing everything.