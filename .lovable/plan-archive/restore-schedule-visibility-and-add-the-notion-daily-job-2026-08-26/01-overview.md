# Restore schedule visibility (and add the Notion daily job)

## Direct answers

**Is anything broken today?** No. The guardrail sits on my SQL path, not on pg_cron itself. Every existing scheduled job (the 15-minute v3 closed sync, the daily Slack closed-won poll, the daily Linear sync, the coverage snapshot) keeps firing exactly as before. Verified: `v3_unattributed_sync_status()` still reads `cron.job` and reports `every 15 min`, next fire 19:45 UTC.

**Can it cause issues down the road?** Yes — one specific, real class of issue: I lost read access to the schedule table. `psql` returns `permission denied for schema cron`, and the Supabase read tool refuses any query naming `cron`. That means:

- I cannot tell you what is scheduled, whether a job is `active`, or when it last ran.
- If a scheduled edge function is renamed, or a bearer token embedded in an old `net.http_post` command goes stale, the job fails silently and I cannot see it. Only `integration_health` would catch it — and only for functions that write a health key.
- Every future scheduled edge function becomes a hand-off to you, with no way for me to verify afterwards that it landed correctly.

**Fix now, or just run the SQL manually?** Both, and they are separate things:

- The Notion job itself: you run the SQL. That is one statement and does not need a build.
- The visibility gap: worth fixing now, and it is small. A `SECURITY DEFINER` read-only function is already the pattern this project uses to peek at `cron.job` (`v3_unattributed_sync_status` does exactly this and still works). Generalising it gives me — and the Settings page — a permanent, auditable list of what is scheduled.

Recommendation: **do both, in this order.** The read-only introspection first (so I can verify), the Notion cron second (so I can confirm it registered).

## Boundary

The write path stays yours. This plan adds **no** ability for the agent or the app to create, alter, or delete a cron job. It adds read-only introspection only.
