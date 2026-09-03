# Demo-ready remix of the Support Hub

Yes — remix, then convert the copy into a demo. The original project is never touched: all purging, seeding, and genericizing happens in the remix, and only the remix gets published.

Agreed on the presenter overlay only, no guided tour. Since you drive the demo live, a tour would compete with your narration; the overlay is a keyboard-triggered card you can pull up per page ("what this screen does, why it matters, time saved") and quietly ignore when you don't need it.

## What the demo becomes

- A fictional company — "Northwind Software" — with `@northwind.example` style customer domains, fictional teammates, and fictional accounts.
- Generic vendor language: Intercom becomes "Helpdesk", Slack becomes "Chat", Linear becomes "Issue tracker", Gmail becomes "Email". No Lovable branding anywhere in the UI.
- Hundreds of seeded tickets across several months, shaped so the interesting screens have something to say: SLA breaches, triage misses, engineering-wait cases, reopens, CSAT ratings, unattributed customers, open escalations.
- Every external integration replaced by a local mock returning the same shape, so no button is dead and no secret is needed.

## Core story scope

Seeded and polished for the demo path:

- Inbox v3 (list + detail pane, at ultrawide width)
- Analytics v3 and Trend report
- SLA report, SLA workbench, Resolution anatomy
- Customers (coverage, attribution, proposals)
- Action Center and Triage
- Monthly lookback (the narrative/Slack-summary payoff)

Reachable but intentionally thin: Backlog, Float coverage, Deep search, People, Changelog, Flow diagram, Project knowledge. Ingestion and admin tooling (imports, policy admin, users, test-channel review) get hidden from the nav so the demo has no dead ends.

## Hard safety rules

- Nothing runs against the source project. The first step in the remix is confirming it has its own backend — a remix can point at the live one, and a wipe there would destroy production data. If it is shared, work stops until that is resolved.
- No connector is called even where credentials still exist; every integration is mocked.
- The demo is only declared ready after a written audit passes, not when the seeding finishes.
