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

## Prompts to paste in the remix chat

Send these one at a time, waiting for each to finish. Reply to the remix's setup checklist first with prompt 0.

0. Setup checklist

```text
Do not connect any Gmail, Slack, Linear, Notion or Intercom connection, and leave GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, INTERCOM_API_TOKEN, INTERCOM_WEBHOOK_SECRET, SLACK_BOT_TOKEN and SLACK_SIGNING_SECRET unset. This project is being converted into a self-contained demo with fake data and mocked integrations. Only generate a fresh random ESH_CRON_SECRET.
```

1. Backend isolation check

```text
Before changing anything: confirm this remix has its own backend database and is not pointing at the source project's. Show me the project ref this app connects to and the row counts of the main data tables (intercom_tickets_v3, v3_customer_accounts, conversations, messages, esh_search_index and any other data tables). Do not delete anything yet. Tell me plainly whether a wipe here is safe.
```

2. Wipe real data

```text
Wipe all real data from this remix. Delete every row from the data tables (children before parents, null out self-references first, skip append-only audit tables with delete-blocking triggers), and delete outright any seed/fixture files in the repo that contain real names, emails, domains or customer copy. Then grep the codebase for real names, @lovable.dev addresses, real customer domains, internal Slack/Notion links and internal office locations, and show me what is left.
```

3. Deterministic demo data generator

```text
Create src/lib/demo-data.ts exporting generateDemoData(), using a seeded mulberry32 PRNG and never Math.random, so output is identical on every run. Model a fictional company "Northwind Software" with contacts at northwind.example.com and a handful of customer accounts of varying size. Generate a few hundred tickets across the last four months with a realistic long-tail distribution, and deliberately plant the cases the app exists to surface: SLA breaches, long engineering waits, long customer waits, reopened-after-close tickets, unattributed customers, missing severity, missing product area, low CSAT, and a few tickets with linked issue-tracker items. Read the real table schemas first and respect generated columns, CHECK constraints and FK order. Return a stats object of what was generated.
```

4. Wipe/seed core, reset button and CLI

```text
Create src/lib/demo-seed-core.ts exporting wipeAll(admin) and seedAll(admin, userId) with no request context, then two callers: an admin-gated edge function demo-reset (plus a getDemoStatus function returning current row counts and last reset time), and scripts/seed-demo.ts for first seed. Add a "Demo data" card on the settings/admin page showing current counts and last reset, with a destructive-styled reset button behind a confirm dialog. Run the seeder now and report the row count per table.
```

5. Mock the integrations

```text
Replace every external integration call with a local mock. For each of Intercom, Slack, Gmail, Linear and Notion, keep the exported function signatures and return shapes identical, but build responses from generateDemoData() instead of fetch, so no feature is dead and nothing ever calls a live vendor. Disable or no-op any scheduled sync jobs that would otherwise overwrite the seeded data. List every call site you changed.
```

6. Genericize terminology

```text
Genericize all user-visible vendor and internal vocabulary: Intercom becomes Helpdesk, Linear becomes Issue tracker, Slack becomes Chat, Gmail becomes Email. Also replace Lovable-specific branding, owner names, team names and internal jargon with generic equivalents, and update page titles, the index.html title and meta description, and the sidebar. Do not rename database columns — schema names are not user-visible.
```

7. Open sign-in up

```text
Remove the domain restriction on sign-in so any Google or email/password account can log in, and auto-grant the app's main role on first sign-in so a viewer never lands in an approval queue. Add a code comment saying this is safe only because all data in this project is fake. Replace any hardcoded internal-email permission checks with role checks.
```

8. Verify and publish

```text
Verify the demo end to end: sign up with a throwaway email in a script and confirm a session is issued, the role is auto-granted and RLS reads return the full dataset; then use Playwright at 1280x1800 to walk Inbox v3, Analytics/Trends, SLA report, SLA workbench, Resolution Anatomy, Customers, Action Center and Monthly Lookback, screenshotting each and confirming no empty states and no console errors. Press the reset button and confirm counts return to the same numbers. Re-run the real-data greps. Write demo-readiness.md with pass/fail per check, then publish.
```

## Technical notes

- The generator uses a seeded PRNG (mulberry32), never Math.random, so screenshots and reset stay stable.
- Wipe and seed live in one shared module called by both a server function (behind an admin check) and a CLI script.
- ESH_CRON_SECRET is generated fresh in the remix; it is not copied from this project.

