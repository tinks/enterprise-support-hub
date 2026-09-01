## Problem

The three-way clock (active / closed / customer wait) assumes that once we send a public reply, the ball is with the customer. When that reply is "we've escalated this to engineering", the ball is actually with us — it just isn't with Support. Today that time lands in `resolution_customer_wait_s` and makes customer turnaround look worse than it is while hiding internal fix latency.

## Decision taken

Add a **fourth bucket**: engineering wait. It is ours organizationally, but not Support's responsiveness. It is carved **out of customer wait only**, so `resolution_active_s` stays byte-identical to today and the identity becomes:

```text
active + closed + customer_wait + eng_wait == window
```

The detection signal is **Linear**, not the "Escalated to Engineering" attribute (that attribute tracks how often Support consults engineering, not whether a dev fix is pending).

## Verified current state

- `dev_escalations`: 43 rows, all created 2026-08-24 or later; 42 carry a `linear_key`. Mirrors `linear_state` only — no Linear timestamps are stored today.
- Intercom `Escalated Issue` attribute (holds the Linear URL) has timestamped set-events in `raw_payload`: 49 events across 48 tickets, 2026-07-24 → 2026-09-01.
- `sync-linear-escalations` currently requests only `identifier title url state{name type} assignee{name}` — no `createdAt` / `startedAt` / `completedAt` / `canceledAt`.

Coverage is therefore thin before late July 2026. The plan reports coverage explicitly rather than implying the new bucket is complete history.
