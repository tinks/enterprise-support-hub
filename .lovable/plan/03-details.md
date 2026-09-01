## Technical details

### Migration (additive only)

```sql
alter table public.intercom_tickets_v3
  add column if not exists resolution_active_s integer,
  add column if not exists resolution_active_bh_s integer,
  add column if not exists resolution_closed_s integer,
  add column if not exists sla_clock_start_at timestamptz,
  add column if not exists active_clock_computed_at timestamptz,
  add column if not exists active_clock_engine_version integer;
```

All nullable. Nothing is dropped or renamed; `time_to_resolve_s` stays as the raw elapsed value.

### Shared module

`src/lib/slaMetrics.ts` keeps `computeSla` and every derived metric. The pure part it depends on — part-timeline construction, actor classification, the business-hours helper, and `computeResolutionActive` — moves to a new dependency-free module the edge functions can import. `slaMetrics.ts` re-exports from it so existing callers do not change. A parity check runs the shared module and the current in-file implementation against a fixture set and asserts identical output before the old code is deleted.

Business-hours variant caveat: `resolution_active_bh_s` depends on the SLA policy version in force. It is stored as a convenience for reporting, stamped with `active_clock_engine_version`; if the policy's business hours ever change retroactively, that column is recomputed by re-running the backfill. `resolution_active_s` (wall seconds, ball-in-our-court) is policy-independent and is the durable value.

### Finalize path

`supabase/functions/_shared/v3-finalize.ts` already fetches the full conversation. It computes the active clock from that payload and includes the new fields in the same upsert, so no extra API call and no second write. Refinalize after a real reopen recomputes and overwrites.

### Backfill

New edge function `backfill-v3-active-clock`:
- selects finalized rows where `active_clock_engine_version` is null or below current, batched (default 100 per call, cursor by `intercom_created_at`);
- computes from `raw_payload` only — no Intercom calls;
- rows with no usable parts get `resolution_active_s = null` and are counted as `skipped_no_parts` rather than silently zeroed;
- returns `{processed, written, skipped_no_parts, failed}`; a "Run now" button is added next to the other integration runners.

### Surface changes

Headline resolution metric switches to `resolution_active_s` on Analytics v3, Trend report, Monthly lookback, Insights, and both owner dashboards, with raw elapsed shown beside it as "elapsed (incl. closed time)". Tickets with a null active value are excluded from the active median and reported as an explicit "not computable" count — never counted as zero. Monthly lookback's manual "Load active clock" button is removed once the column is populated.

### Verification before this is called done

1. Backfill completes; report row counts written vs skipped, and confirm no finalized row is left at a stale engine version.
2. Pick 3 tickets with reopens and 3 without, and show raw vs active side by side with the parts timeline, so the delta is explainable per ticket.
3. Negative case: a ticket with zero conversation parts and a ticket closed before any agent reply — confirm both land as null/`0` deliberately and are excluded, not silently averaged in.
4. Compare the new persisted value against `/resolution-anatomy` (`total − closedS`) for the same tickets; any disagreement is named and explained rather than smoothed.
5. Doc pass: `.lovable/project-knowledge.md` via `sync-knowledge-pending`, a `changelog_entries` row, and a FlowDiagram node.

Until steps 1-4 have visibly run, the metric is reported as UNVERIFIED.
