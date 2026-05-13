# Fix: switching team-member dashboards is ignored

## Root cause

`src/pages/OwnerDashboard.tsx` renders `<Conversations forceOwner={ownerName} />`. React Router keeps the same `Conversations` instance mounted across `/my/joel` → `/my/kristina` and just updates the prop.

In `src/pages/Conversations.tsx` line 336:

```ts
const [ownerFilter, setOwnerFilter] = useState<OwnerFilter>(
  forceOwner as OwnerFilter || (paramOwner as OwnerFilter) || savedOwner || "all"
);
```

`useState`'s initializer runs only on the first mount. When `forceOwner` changes, `ownerFilter` stays on the first owner, so every query, the unified memo, and the table keep filtering by the original person. The card title updates because it reads `forceOwner` directly — that's why the header looks correct while the rows don't change.

## Fix (frontend only, smallest change)

In `src/pages/Conversations.tsx`, add a sync effect right after the existing `forceOwner`-aware state declarations:

```ts
useEffect(() => {
  if (forceOwner) setOwnerFilter(forceOwner as OwnerFilter);
}, [forceOwner]);
```

This ensures every navigation between `/my/<owner>` routes pushes the new owner into `ownerFilter`, which is what all downstream filtering, `loadData`, and the `unified` memo key off.

Also reset `page` to 1 on the same change so the user lands on the first page of the newly filtered list (the existing filter-reset effect already lists `ownerFilter`, so this is automatic once `ownerFilter` updates — no extra code needed).

## Belt-and-braces alternative (optional)

If we'd rather guarantee a clean slate (clears search input, expanded rows, scroll position, any other prop-seeded state) we can force a remount in `src/pages/OwnerDashboard.tsx`:

```tsx
return <Conversations key={ownerName} forceOwner={ownerName} />;
```

Recommend shipping the `useEffect` fix only — it's targeted and preserves UI state like column widths and filters the user may want kept across owners. Add the `key=` remount only if QA finds other stale prop-seeded state.

## Verification

- Navigate `/my/joel` → table shows Joel's rows.
- Navigate to `/my/kristina` from the sidebar flyout → table immediately re-filters to Kristina, page resets to 1, header updates.
- Repeat across Tine and Eren.
- Direct URL load of `/my/<owner>` still works (initial `useState` value is unchanged).
- `/conversations` (no `forceOwner`) is unaffected — the effect's `if (forceOwner)` guard skips it, preserving the saved-filter behaviour.

## Out of scope

- No backend, RLS, or query changes.
- No changes to pagination logic, search, or `OwnerDashboard` routing.
- Other prop/URL-seeded `useState` initializers are not touched unless QA surfaces a similar bug.
