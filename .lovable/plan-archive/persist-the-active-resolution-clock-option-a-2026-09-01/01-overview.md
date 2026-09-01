# Persist the active resolution clock (Option A)

## Honest assessment

Counting closed time is wrong, and it is wrong in a way that gets worse over time. A ticket that is closed on day 1, sits dormant for nine days, and is reopened for ten minutes currently reports ~10 days to resolve. Every surface that reports "median resolution" inherits that inflation: the more reopens we get, the worse the number looks, even if the team is faster. That is exactly the failure mode this Hub exists to eliminate — a metric that quietly lies.

Two caveats I want on record before we build:

1. Active clock is not "better raw" — it is a different measure. It answers "how long was the ball in our court while the ticket was open?", not "how long did the customer wait end to end". Customer-perceived elapsed time is still real. So the raw number should stay visible, not be deleted.
2. `time_to_resolve_s` comes from Intercom (`statistics.time_to_last_close`). The active value will be Hub-computed from the stored payload. Where they disagree, the Hub value is the one we defend — which means we must be able to show its inputs, not just the number.

Verified before writing this plan: 587 of 650 v3 tickets are finalized and their `raw_payload` already carries the full `conversation_parts` list and `statistics`, so the backfill can be computed entirely from the database with no Intercom re-fetch.

## What gets built

1. **Schema (additive)** — new nullable columns on `intercom_tickets_v3`: `resolution_active_s`, `resolution_active_bh_s`, `sla_clock_start_at`, `resolution_closed_s` (dormant time excluded), and `active_clock_computed_at` plus `active_clock_engine_version`.
2. **One shared active-clock module** — the timeline build + stop-the-clock loop that today lives inside `src/lib/slaMetrics.ts` moves into a single file that both the frontend engine and edge functions import. No second copy of the rule.
3. **Write at finalize** — `_shared/v3-finalize.ts` computes the active clock from the payload it already has in hand and writes it in the same upsert. Reopen/refinalize recomputes it.
4. **Backfill function** — `backfill-v3-active-clock`, batched over finalized rows, computing from `raw_payload`. Re-runnable; skips rows already at the current engine version unless forced.
5. **Surfaces** — Analytics v3, Trend report, Monthly lookback, Insights and the owner dashboards read the persisted column as the headline resolution metric, with raw wall clock kept as a secondary line labelled "elapsed". Monthly lookback's manual "Load active clock" button becomes unnecessary and is removed.

## What is explicitly out of scope

- No change to `v3_derive_customer`, triggers, or SLA policy resolution.
- No change to the stop-the-clock rule itself. This plan persists the existing rule; it does not retune it.
