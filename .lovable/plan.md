## Goal

From the Insights → Report → Owner load table, let you click a row (e.g. "Unassigned · 21") and land on the Conversations page already filtered to exactly those tickets so you can reassign them.

## Changes

**1. `src/pages/Conversations.tsx` — read `owner` from the URL**

- Add `const paramOwner = searchParams.get("owner")` next to the other params.
- When `paramOwner` is present, use it as the owner filter instead of the localStorage value (and skip writing it to localStorage so it does not stick after you leave).
  - Values: any owner name (e.g. `Kristina`), `unassigned`, or `all`.
- Include `paramOwner` in the filter `useMemo` deps.

**2. `src/pages/insights/ReportTab.tsx` — make Owner load rows clickable**

- Each `<tr>` in the Owner load table becomes a link to:
  ```
  /conversations?owner=<name|unassigned>&from=<monthStart>&to=<monthEnd>
  ```
  using the same month range the report is built from (already available via `month` / `data`).
- Style: hover row highlight + cursor pointer, keep the same columns.
- "Unassigned" maps to `owner=unassigned`; everything else to `owner=<Name>` exactly as displayed.

## Result

Clicking the "Unassigned · 21" row in Owner load opens Conversations pre-filtered to those 21 tickets for the selected month, where you can update each owner inline.

## Out of scope

- No DB or aggregation changes — the count in Owner load and the count in Conversations come from the same source already, so they will match.
- No changes to other Report cards.