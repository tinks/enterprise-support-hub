

## Backfill April 2026 only

### Approach
Add an optional date range filter to the existing `backfill-enterprise-inbox` edge function and the UI button, so we can limit imports to tickets created in April 2026 (2026-04-01 → 2026-04-30 UTC).

### Changes

**1. `supabase/functions/backfill-enterprise-inbox/index.ts`**
- Accept optional `createdAfter` and `createdBefore` (unix seconds) in the request body.
- Add them to the Intercom search query as additional `AND` clauses on the `created_at` field, alongside the existing `team_assignee_id` filter.

**2. `src/pages/Index.tsx`**
- Add a second button next to "Run backfill": **"Backfill April 2026"**.
- Handler computes the unix timestamps for `2026-04-01 00:00 UTC` and `2026-05-01 00:00 UTC`, then runs the same batched loop passing those bounds in each request.
- Reuse all existing batching, toast, and stats logic.

**3. `src/pages/FlowDiagram.tsx`**
- Note on backfill node: "Supports optional date-range filter for targeted backfills."

### Why this approach
- Server-side filtering via Intercom's search API is the only way to scope efficiently — filtering client-side would still paginate through all 406 tickets.
- Adding bounds as optional params keeps the existing full-backfill button working unchanged.
- Same batching pattern means no new timeout risk.

### Files
- Edit: `supabase/functions/backfill-enterprise-inbox/index.ts`
- Edit: `src/pages/Index.tsx`
- Edit: `src/pages/FlowDiagram.tsx`

