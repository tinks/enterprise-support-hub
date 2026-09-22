# Archive: incident ingestion rollout notes

Historical narrative and verification logs relocated out of `.lovable/project-knowledge.md` on 22 Sep 2026. Text is verbatim; line references are to the pre-trim file (2,697 lines).

## L2461

**Verified 3 Sep 2026.** Full rescan: 2,026 Slack messages scanned, 1,049 announcements parsed, 964 skipped as non-announcements, 1,049 rows upserted, 0 errors, no unknown status formats. Resulting population: **1,008 closed · 10 live · 6 post-incident · 25 unknown**. The 25 unknown are all Jan–Feb 2025 (the earliest incident.io card format, no status signal at all) and are left honestly unknown. Typecheck clean.

## L2465

**Verified 4 Sep 2026 (first fire).** 21:45:06 UTC: `integration_health.slack_incidents_poll` → `last_status = ok`, `last_success_at = 21:45:06`, `consecutive_failures = 0`; 7 incident rows re-stamped in that run and the population moved 1,049 → 1,050 (one new incident ingested by the cron, not by a manual call).

## L2467

**UNVERIFIED.** The schedule row itself was never read back: `cron.job` and `cron.job_run_details` are permission-denied for both the agent SQL role and the psql role, so recurrence is inferred from the on-the-minute success at `:45` plus the job id returned in the SQL editor, not directly observed across two fires. The banner and `/incidents` page were still not loaded in a browser at ultrawide width.

## L2479

**Verified 9 Sep 2026.** Rolling run after the fix: `recheck_fetched: 37, recheck_changed: 1, recheck_missing: []`. INC-1913 moved `Investigating`/live → `Merged`/closed with `resolved_at 2026-09-06 13:02:04Z`. Live population **15 → 13**. Negative case exercised for real: before the inline-URL fix the same run logged `recheck INC-1913: unparseable announcement` and left the row untouched — the failure was visible, not silent. Full rescan re-run with the new parser: 2,038 scanned, 1,228 parsed (was 1,049), 797 skipped, **171 previously-unparseable terminal cards recovered**, 0 errors. Population now **1,182 closed · 13 live · 8 post-incident · 25 unknown**.

## L2481

**UNVERIFIED.** No cron fire has been observed since the change (next `*/15` run); the re-check path has only been exercised by manual invocation.
