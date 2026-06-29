## Current health check coverage

The `integration_health` table is written to by 5 edge functions via `_shared/integration-health.ts`, and the Settings → Integration health card (plus 10-min Slack alert cron `integration-health-alert`) reads it:

| Key | Recorded by | Freshness window | Covers Inbox V2? |
|---|---|---|---|
| `intercom_poll` | `poll-intercom-inbox` | 30 min | No — different function |
| `intercom_webhook` | `intercom-webhook` | 24 h | Partial — webhook hits live tables, not `inbox_v2_tickets` |
| `intercom_csat` | `refresh-intercom-csat` | 3 h | No — only touches manual/gmail tables |
| `intercom_import` | `import-intercom-ticket` | 30 d | No |
| `gmail_poll` | `poll-gmail` | 30 min | No |

**Inbox V2 sync is invisible to health monitoring.** Neither `sync-inbox-v2` (crons: every 15 min + nightly 03:00 UTC) nor `classify-inbox-v2-engagement` call `recordIntegrationHealth`. If Intercom's token expires, rate-limits, or the function starts timing out (as it did during the recent full backfill), nothing surfaces in Settings or `#enterprise-support-hub-alerts` — the sandbox just silently goes stale.

## Recommendation: add one new integration key

Add a single `inbox_v2_sync` health entry rather than splitting frequent vs nightly. The frequent run (15 min, 2 h window) is the canary; if it's healthy, the nightly is almost certainly fine too.

Skip a separate entry for `classify-inbox-v2-engagement` — it's on-demand only (no cron), so "stale" has no meaning. Per-call errors are already toasted in the UI.

## Plan

1. **`_shared/integration-health.ts`** — extend `IntegrationKey` union with `"inbox_v2_sync"`.
2. **`sync-inbox-v2/index.ts`** — call `recordIntegrationHealth(sb, "inbox_v2_sync", classifyHttpStatus(res.status), errorText)` after each Intercom search/conversation fetch, mirroring the pattern in `poll-intercom-inbox`. One `ok` write at the end of a successful run; `auth_error`/`error` on first failure with early return.
3. **`IntegrationHealthCard.tsx`** — add `{ key: "inbox_v2_sync", label: "Inbox V2 sync", description: "Mirrors Intercom into the Inbox V2 sandbox (every 15 min).", maxStaleMin: 30 }` to the `INTEGRATIONS` array.
4. **`integration-health-alert/index.ts`** — add the same entry to its `INTEGRATIONS` array so Slack alerts cover it with the same 6-hour re-notify dedup.
5. **Docs** — update `.lovable/project-knowledge.md`, `mem://features/inbox-v2/sync-and-export`, and add a `changelog_entries` row.

## Out of scope (call out, don't build)

- Separate `inbox_v2_classify` health key — no cron, on-demand only.
- Row-count drift alerts (e.g. "expected ~N tickets, got M") — different problem class; would need a baseline table.
- Backfilling the historical `intercom_webhook` check to also write `inbox_v2_sync` — the webhook doesn't touch `inbox_v2_tickets` today, so it would be misleading.

Confirm and I'll implement.
