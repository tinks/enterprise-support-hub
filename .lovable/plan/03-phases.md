## Phase 0 — Quantify before building (read-only)

Measure, on finalized v3 tickets: how many carry a Linear reference, how many of those have a usable escalation timestamp, and what share of their `resolution_customer_wait_s` would move into engineering wait. If the answer is "a handful of tickets", we stop and reconsider rather than shipping a bucket that is mostly null. Report coverage % as a number, not a claim.

## Phase 1 — Persist Linear timestamps

Extend `sync-linear-escalations` to request `createdAt startedAt completedAt canceledAt state{name type}` and store them on `dev_escalations` as `linear_created_at`, `linear_started_at`, `linear_completed_at`, `linear_canceled_at`, `linear_state_type`. Still read-only against Linear; still never touches human-owned columns (`hub_state`, `note`, `owner`, `linear_url_override`).

## Phase 2 — Engine v3

Add `computeEngineeringWait` to `supabase/functions/_shared/sla-core.ts`, bump `ACTIVE_CLOCK_ENGINE_VERSION` to 3.

Window per ticket:
- **Start** = the earliest evidence the ticket was escalated: the Intercom `Escalated Issue` / `Linear Issue` attribute set-event timestamp from `raw_payload`; fall back to `dev_escalations.created_at`; fall back to the Linear issue's `createdAt`. Clamped to `sla_clock_start`.
- **End** = Linear `completedAt` or `canceledAt`; fall back to `close_at`. Clamped to `close_at`.
- The window is then **intersected with the existing customer-wait segments**. Time when the ball was already with us (active) or the ticket was closed is never reclassified.

Record `eng_wait_source` (`attribute_event` / `dev_escalation_row` / `linear_created`) so every non-zero value is auditable back to its signal.

## Phase 3 — Schema + backfill

Migration adds to `intercom_tickets_v3`: `resolution_eng_wait_s`, `resolution_eng_wait_bh_s`, `eng_wait_start_at`, `eng_wait_end_at`, `eng_wait_source`. `v3-finalize` and `backfill-v3-active-clock` write them.

Verification gates, all run and shown before this is called done:
1. Identity holds on every row: `active + closed + customer_wait + eng_wait == window`.
2. `resolution_active_s` is byte-identical to the pre-backfill snapshot on all 592 finalized rows.
3. Every row with `resolution_eng_wait_s > 0` has a non-null `eng_wait_source` and a Linear key.
4. Negative case: a ticket with a Linear reference attached *after* close, and a ticket whose Linear issue is still open, both produce a defensible value — named and shown, not assumed.

## Phase 4 — Surfaces

`/resolution-anatomy` moves to a four-way split; Analytics v3 sub-line, Trend tooltip, and the SLA report gain "eng wait" alongside customer wait. Where coverage is partial, the surface says so rather than rendering 0.

## Phase 5 — Doc pass

`.lovable/project-knowledge.md` via `sync-knowledge-pending`, a `changelog_entries` row, and a FlowDiagram node for the four-way clock.

## Open item

No manual override is included: engineering wait is entirely Linear-derived. If Phase 0 shows meaningful cases with no Linear issue (escalated by Slack DM, fixed without a ticket), a per-ticket override table is a follow-up, not part of this build.
