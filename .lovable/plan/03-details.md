## Step 1 — Read-only schedule introspection (I build this)

One migration adding a `SECURITY DEFINER` function, admin-gated, mirroring the pattern `v3_unattributed_sync_status()` already uses:

- `public.esh_cron_jobs()` returns `jobname`, `schedule`, `active`, `command_summary`, plus `last_run_at`, `last_status`, and `last_message` joined from `cron.job_run_details`.
- `command_summary` is a **redacted** rendition: the target function name and the schedule only. Any `Authorization` / `Bearer` value in the command is stripped before it leaves the function, so no credential can surface in the UI or in my tool output.
- Guarded by `has_role(auth.uid(), 'admin')`, matching `list_users_with_roles()`.
- `GRANT EXECUTE` to `authenticated` only; no `anon`.

Then a **Scheduled jobs** panel on Settings, next to Integration health: job name, cadence, active flag, last run, last status. Rows whose last run failed, or whose last run is older than twice their cadence, get flagged — the same staleness idea as the health card, but sourced from pg_cron itself rather than from each function's self-report.

This closes the real gap: silent failure of a scheduled job becomes visible without depending on that function remembering to write a health key.

## Step 2 — The Notion daily job (you run this)

After step 1 lands, run in the SQL editor:

```sql
select cron.schedule(
  'publish_registry_notion_daily',
  '0 5 * * *',
  $$
  select net.http_post(
    url := 'https://<project>.supabase.co/functions/v1/publish-registry-notion',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer <same token your other daily jobs use>"}'::jsonb,
    body := '{}'::jsonb
  );
  $$
);
```

Copy the `headers` value from an existing daily job (`select command from cron.job where jobname = 'poll-slack-closed-won'` or similar) so the credential matches what already works.

## Step 3 — Verification (I run this, after step 2)

- Call `esh_cron_jobs()` and confirm `publish_registry_notion_daily` is present, `active = true`, cadence `0 5 * * *`.
- The morning after: confirm `last_status = 'succeeded'` and that `integration_health.notion_registry_publish` is `ok` with a fresh timestamp.
- Negative case to name explicitly: an unchanged registry produces `changed: false` and **zero** Notion requests, so a healthy no-op morning looks identical to a real sync in `integration_health`. The pg_cron `last_status` is what distinguishes "ran, nothing to do" from "did not run".
- Until both of those are observed, the schedule is UNVERIFIED.

## Docs

Per standing convention, after step 3: `.lovable/project-knowledge.md` staged through `sync-knowledge-pending`, a `changelog_entries` row, and a FlowDiagram node for the Notion publish schedule and the new Scheduled jobs panel.

## What this plan deliberately does not do

- No agent or app write path to `cron` — no create, alter, or delete.
- No change to `publish-registry-notion` itself; its hash idempotency and health reporting already work.
- No attempt to migrate the other existing HTTP cron jobs; they run fine and touching them risks breaking working schedules for no gain.
