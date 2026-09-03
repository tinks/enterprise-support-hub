## The checklist

Run each in the remix chat, one at a time. Each is written so the answer is a fact, not an opinion — a ref, a count, a hostname list, an HTTP status.

### 1. Data boundary

```text
Print the Supabase project ref this app is configured with, from both .env and supabase/config.toml, and confirm they match each other. Then give me row counts for every non-empty table, and for the three biggest tables show 5 sample rows so I can see the values are generated, not real. State plainly whether any row in this database could have come from another project.
```

Pass: one ref, same in both files, and no real names, real domains or @lovable.dev addresses in the samples.

### 2. Outbound boundary — static

```text
Grep every edge function for api.intercom.io, slack.com, googleapis.com, hooks.slack.com, linear.app and api.notion.com, and for Deno.env.get of GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, INTERCOM_API_TOKEN, INTERCOM_WEBHOOK_SECRET, SLACK_BOT_TOKEN, SLACK_SIGNING_SECRET. For each hit, tell me what happens now that the secret is absent: mock, clean no-op, or thrown error. List the ones that throw separately — those are the demo's broken buttons.
```

Pass: zero paths that throw. Anything that throws gets fixed to return mock data with the same shape.

### 3. Outbound boundary — live

```text
Invoke each function a demo click can reach (esh-write-action, post-reply, sync-intercom-fields, sync-v3-open, sync-v3-closed, poll-gmail, and any Slack handler) and show me the HTTP status and response body for each. Confirm none of them made an outbound request to a vendor host. Then list the current secret names in this project and confirm the six vendor secrets are gone.
```

Pass: no 5xx, no vendor call, six secrets absent.

### 4. Scheduled jobs

```text
List every pg_cron job and scheduled trigger in this project. Any job that syncs from a vendor or overwrites seeded data must be unscheduled — do that and show me the job list again afterwards.
```

Pass: nothing left that could mutate the seed between rehearsal and demo.

### 5. Reset determinism

```text
Record row counts per table, press the demo reset, then record them again and diff. They must be identical. If any table differs, tell me which and why.
```

Pass: identical counts. This is what makes a mid-demo mistake recoverable.

### 6. Walkthrough

```text
Use Playwright at 1280x1800 to visit Inbox v3, Analytics/Trends, SLA report, SLA workbench, Resolution Anatomy, Customers, Action Center and Monthly Lookback. Screenshot each, and report per route: any empty state, any console error, any network request to a non-localhost host.
```

Pass: no empty states, no console errors, no external requests.

### 7. Written record

```text
Write demo-isolation.md at the repo root with each of the seven checks above, the exact command or query run, the actual output, and pass/fail. Mark anything you could not directly verify as UNVERIFIED rather than assuming.
```

## Notes

- Deleting the secrets is the structural guarantee; checks 2 and 3 exist to prove no feature broke as a side effect of it.
- Check 5 is the only one that must be re-run right before the demo, since a rehearsal will have dirtied the data.
- Nothing in this checklist touches the production project — every command runs against the remix's own backend.
