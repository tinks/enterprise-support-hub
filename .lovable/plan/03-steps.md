## What to do in the remix

Run these in the remix's own chat, in order.

1. Confirm the remix has its own backend, not a pointer at the source's. Compare row provenance before anything is deleted. If it turns out shared, stop — a wipe would destroy production data.
2. Wipe every data table in the remix and delete real fixture/seed files outright.
3. Add a deterministic seeded generator for a fictional company (example.com email domain), a few hundred tickets across several accounts, and deliberately planted edge cases: SLA breaches, engineering waits, reopens, unattributed customers, missing severity.
4. Replace each connector call with a local mock that keeps the same function signature and returns generated data, so no button is dead and nothing calls a vendor.
5. Genericize vendor and internal vocabulary in UI copy: Intercom to Helpdesk, Linear to Issue tracker, Slack to Chat, plus page titles and metadata.
6. Open sign-in up (no domain restriction) and auto-grant the app role on first login, safe only because the data is fake.
7. Add a reset button that re-seeds to the same state, so a broken demo is one click from clean.
8. Walk every core route at a wide viewport, confirm no empty states and no console errors, then publish.

Core routes for the demo: Inbox v3, Analytics/Trend, SLA report and workbench, Resolution Anatomy, Customers, Action Center/Triage, Monthly Lookback.

## Technical notes

- The generator uses a seeded PRNG (mulberry32), never Math.random, so screenshots and reset stay stable.
- Wipe and seed live in one shared module called by both a server function (behind an admin check) and a CLI script.
- ESH_CRON_SECRET is generated fresh in the remix; it is not copied from this project.
