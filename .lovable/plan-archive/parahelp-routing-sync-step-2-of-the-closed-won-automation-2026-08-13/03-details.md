## What gets built

**1. Discovery first (before any Parahelp call is written)**
Confirm with Parahelp whether domain→inbox routing is settable over an API, and what auth it uses. Until that answer exists, the push worker ships with the API leg stubbed and disabled — everything else is fully useful on its own.

**2. Routing queue table** — `public.parahelp_routing_sync`
One row per domain that should be routed. Fields: the domain, the account it belongs to, where it came from (closed-won poller / manual / backfill), state (`pending`, `pushed`, `manual_done`, `failed`, `skipped`), attempt count, last error, who marked it done, timestamps. Admin-gated writes, readable by authenticated users, plus service-role access for the edge functions.

Rows are created by a database trigger on `v3_customer_accounts` that fires whenever a new domain appears in the `domains` array — so the poller needs no code change at all, and manual registry adds are covered for free. Existing registry domains are seeded once as `skipped` (already routed) so the queue starts clean and only tracks new arrivals.

**3. Push worker** — new edge function `sync-parahelp-routing`, own daily cron, own `integration_health` key
Reads `pending` rows and, per row:
- If the Parahelp API leg is enabled and configured, calls it and marks `pushed`, or `failed` with the error text (retried on later runs, capped).
- Always posts a Slack summary of what remains pending to the existing enterprise-support channel, so nothing sits silently.

It never touches `v3_customer_accounts` and never runs inside the poller — a Parahelp outage cannot block or corrupt a registry update.

**4. Hub surface** — "Parahelp routing" panel on the Customers page
Lists pending domains oldest-first with age, the source account, and a **Mark as routed** button for the manual path (records who and when). Failed rows show the error and a retry. This is the working queue when the API path isn't available.

**5. Docs + changelog**
`.lovable/project-knowledge.md` gets the new step in the closed-won chain, `FlowDiagram.tsx` gets the queue and worker nodes, and a `changelog_entries` row records it.

## Open item

The Parahelp API question is unresolved. If it turns out there is no API, everything above still ships and the queue is the deliverable — the worker's API leg stays dormant until you have credentials, at which point enabling it is a single function change with no schema or UI work.

## Build order

Migration (table + trigger + seed) → push worker with API leg stubbed → Slack summary → Customers panel → docs pass.
