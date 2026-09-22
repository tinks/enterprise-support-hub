# Archive: Inbox v2 retirement

Historical narrative and verification logs relocated out of `.lovable/project-knowledge.md` on 22 Sep 2026. Text is verbatim; line references are to the pre-trim file (2,697 lines).

## L917-919

- **Cron removed:** `sync-inbox-v2-frequent` / `sync-inbox-v2-nightly` were unscheduled during the 2 Sep cron-credential migration. Deleting the functions makes any surviving schedule a 404 no-op. UNVERIFIED: agent SQL cannot read `cron.job`, so a stray v2 schedule cannot be ruled out by inspection — the last observed v2 write was 16:45 UTC on 2 Sep, before the functions were deleted.
- **Health key corrected:** `sync-v3-closed` had been writing its heartbeat into the `inbox_v2_sync` bucket ("reuse v2 health bucket for now"), so the Settings row labelled *Inbox V2 sync* was actually reporting v3 closed-sync freshness with a wrong 30-min staleness window. It now writes `v3_closed_sync`, surfaced as **Inbox V3 closed sync** (24h window, "Run now" → `sync-v3-closed`) in `IntegrationHealthCard.tsx` and mirrored in `integration-health-alert`. The `inbox_v2_sync` row was deleted from `integration_health` and the key removed from the `IntegrationKey` union.
- **Data:** `public.inbox_v2_tickets` (844 rows, ~9.4 MB after compaction) is dropped separately from the SQL editor — the migration tool refuses destructive DDL. No shipped code reads the table as of this change, so the drop is safe whenever it is run.

## L1842

The ~32 mutation/sync/backfill functions. `pg_cron` invokes them with only the **anon key** as bearer, so applying `requireUser()` to them would silently 401 every scheduled job — `poll-gmail`, `poll-intercom-inbox`, `sync-v3-*`, `reconcile-v3-open`, `promote-pending-intercom-links`, `refresh-intercom-csat`, `sync-parahelp-routing`, `integration-health-alert`, `context-reminder`, `backfill-intercom-replies`, `poll-slack-closed-won`. They need a two-path guard (user JWT **or** a cron secret) plus a rewrite of the cron commands, which is its own batch. Slack/Intercom webhook receivers stay unauthenticated by design and must be signature-verified instead.
