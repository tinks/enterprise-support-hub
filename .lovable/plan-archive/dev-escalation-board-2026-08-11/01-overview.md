# Dev escalation board

A table view at `/escalations` (Issues flyout) that pairs Intercom tickets typed as **Bug** or **Feature Request** with their Linear escalation issue, tracked under a Hub-owned lifecycle that is independent of the Intercom conversation state.

## Population

Primary identifier is the Intercom custom conversation attribute **Ticket type** ∈ {`Bug`, `Feature Request`}, already mirrored on `intercom_tickets_v3.custom_attributes`.

Verified against the live store right now: 22 tickets qualify — 9 Bug (5 finalized, 4 open) and 13 Feature Request (8 finalized, 4 open, 1 reopened). No filtering by Intercom state, so a closed Intercom ticket stays on the board until the Hub says the customer was notified. Tickets resolved as `not_enterprise` or `transferred_out` are excluded, matching the other v3 surfaces.

## Hub lifecycle (independent of Intercom)

`open → in_progress → fix_shipped → customer_notified`, plus a terminal `wont_do`. The board defaults to showing the three non-terminal states; `customer_notified` and `wont_do` are hidden behind a state filter.

A ticket that qualifies gets a **virtual** `open` row — nothing is written until someone changes state, adds a Linear link, or leaves a note. That keeps the board self-populating with no sync job, and the escalations table holds only real human decisions.

## Linear side

Phase 1 is link-only: the board reads the Linear URL or key straight from the Intercom attributes **Linear Issue** and **Escalated Issue** (23 tickets carry one today; some `Escalated Issue` values are Slack links, which are shown as-is but not treated as Linear). A Hub-side override field lets you paste or correct a Linear link per row.

The schema and the row renderer are built for phase 2 up front: nullable `linear_state`, `linear_title`, `linear_assignee`, `linear_synced_at` columns exist from day one and simply render as "—" until a `sync-linear-escalations` edge function is added against the Linear connector. Adding it later is one edge function plus a cron — no migration, no UI rewrite.
