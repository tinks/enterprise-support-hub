## Goal

Add an automated test that exercises the dashboard-switching bug we just fixed: navigating between `/my/joel`, `/my/kristina`, and `/my/sam` must rebuild the conversations table and show only the rows owned by the current route owner each time.

## Approach

We don't have a Playwright config in the repo (only the package is present, no `playwright.config.ts`, no auth fixtures, and the live app requires Supabase Auth). Spinning up a real headless browser against the deployed preview would also depend on real data and a real session, which makes it flaky and unreproducible in CI.

Instead, ship a **Vitest + React Testing Library integration test** that:

1. Renders the real `OwnerDashboard` route through `MemoryRouter`, so all production code paths run (`useParams` → `forceOwner` → `<Conversations key={ownerName} forceOwner={...} />`).
2. Mocks `@/integrations/supabase/client` with a tiny in-memory fixture that returns:
   - `conversation_mappings`, `gmail_conversations`, `manual_conversations`: a fixed dataset where each row's `owner` is one of `Joel`, `Kristina`, `Sam`, `Tine`, plus a couple of `null`-owner rows.
   - `settings.product_areas`: a small CSV.
   - `functions.invoke("list-slack-users" | "list-slack-channels")`: minimal mock responses so `loadLookups` resolves.
3. Drives navigation by re-rendering `MemoryRouter` with a different `initialEntries`, simulating the user clicking from one dashboard to the next.

This is what the testing-library docs call "integration test"; from the user's perspective it is end-to-end of the routing + filtering behaviour, which is exactly what regressed.

## Files

### New: `src/pages/__tests__/OwnerDashboard.test.tsx`

Test cases:

1. **Switching dashboards updates the table.**
   - Render `<MemoryRouter initialEntries={['/my/joel']}><Routes><Route path="/my/:owner" element={<OwnerDashboard/>}/></Routes></MemoryRouter>`.
   - Wait for table rows; assert every visible row's owner cell reads `Joel` (and Kristina/Sam rows are not present).
   - `rerender` with `initialEntries={['/my/kristina']}`, wait for rows, assert every visible row reads `Kristina`.
   - `rerender` with `initialEntries={['/my/sam']}`, repeat.
   - Verify the read-only "Owner: Kristina" / "Owner: Sam" badge in the Filters panel updates each time.

2. **Status default is `resolved`-only on dashboards.**
   - On `/my/kristina`, assert that a Kristina-owned row whose status is `resolved` is **not** rendered, while a Kristina-owned row whose status is `active` or `awaiting_support` **is** rendered. Confirms the `DASHBOARD_HIDDEN` default and that owner-switching doesn't reintroduce inbox defaults.

### New: `src/test/mocks/supabase.ts`

Reusable mock module exporting a `supabase` object with:
- `from(table).select(...).order(...).range(...)` returning the seeded rows for that table (chainable, awaitable).
- `.in(...).order(...)` chains for the search path (no-op return).
- `functions.invoke(name, ...)` returning `{ data: { users: [] } }` / `{ data: { channels: [] } }` as appropriate.
- `rpc(...)` returning `{ data: [] }`.
- `channel(...)` returning a stub with `.on().subscribe()` chain so any realtime hookups don't crash.

The test file calls `vi.mock("@/integrations/supabase/client", () => ...)` to wire it in.

### Maybe touch: `src/test/setup.ts`

Add `localStorage` reset in a `beforeEach` so persisted filter state doesn't bleed between tests. Add `ResizeObserver` and `IntersectionObserver` polyfills if Radix complains during render (only if the test fails without them).

## Out of scope

- No Playwright / browser-driven test (no config, no auth fixtures, requires deployed env).
- No changes to product code.
- No new fixtures wired into CI beyond the existing `bun test` / `vitest run` setup.

## Verification

- Run the new test via the test runner; it must pass.
- Temporarily revert the `key={ownerName}` fix in `OwnerDashboard.tsx` locally and re-run — the test must fail (rows from the first dashboard persist when switching), proving the test actually catches the original regression. Restore the fix afterward.