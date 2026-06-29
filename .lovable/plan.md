# Re-finalize reopened tickets (Inbox v3)

Give users a way to clear `lifecycle_status = 'reopened_after_finalize'` back to `'finalized'` after data-cleanup actions in Intercom (e.g., adding a tag) inadvertently trigger a reopen.

## Behavior

- **Action**: Mark a reopened ticket as finalized.
- **What it changes**: `lifecycle_status = 'finalized'` only. `reopen_count` and `last_reopened_at` are preserved as an audit trail of prior reopens.
- **No re-trigger guard**: if the next sync sees newer Intercom activity, it may flip back to reopened. Accepted tradeoff — the user can re-clear.
- **Scope**: only available when current `lifecycle_status === 'reopened_after_finalize'`.

## UI surfaces

Both live in `src/pages/InboxV3.tsx`:

1. **Row action** — Finalized tab only. On rows with `lifecycle_status = 'reopened_after_finalize'`, render a small icon button (e.g. `CheckCircle2`) next to the existing lifecycle badge. Click → no confirm, runs the update, shows a toast. Optimistic UI: badge flips immediately, reverts on error.
2. **Detail sheet** — when an open ticket detail has `lifecycle_status = 'reopened_after_finalize'`, show a "Mark as finalized" button in the sheet's header/footer area. Same handler.

## Data write

Single Supabase update from the client (table already has authenticated UPDATE permission via existing RLS):

```ts
await supabase
  .from("intercom_tickets_v3")
  .update({ lifecycle_status: "finalized" })
  .eq("id", row.id)
  .eq("lifecycle_status", "reopened_after_finalize"); // guard against races
```

On success, patch local state in `rows`/`activeRows` so KPIs and the lifecycle filter update without a refetch.

## Out of scope

- No bulk select.
- No edge-function changes — purely client-side write.
- No changes to sync logic; reopen detection in `sync-v3-closed` is unchanged.
- No new column / migration.
- Analytics v3 already keys off `lifecycle_status`, so cleared rows automatically count as finalized again — no Analytics changes needed.

## Files touched

- `src/pages/InboxV3.tsx` — row-action button, detail-sheet button, `markAsFinalized(row)` handler, optimistic state patch.

## Follow-up per project rules

- Update `.lovable/project-knowledge.md` (v3 section) with the manual re-finalize action.
- Add a `changelog_entries` row.
- Flow page unchanged (no flow logic change).
