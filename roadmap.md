# Roadmap

## Blocking publish (2026-09-02 — code complete, rescan pending)
- [x] `gmail_oauth_hijack` — `gmail-auth-url` behind `requireEditor`; single-use server-stored
      `state` nonce (`public.gmail_oauth_states`, migration 0029) verified in
      `gmail-oauth-callback` before the token row is replaced. Indicator moved to
      `public.gmail_connection_status()`. All negative cases verified; real Google
      round-trip UNVERIFIED.
- [x] `open_data_read_fns` — all 7 already carried `requireUser`; re-verified 401 on
      unauthenticated and anon-key-only calls.
- [x] `open_mutation_fns` — `_shared/require-editor-or-secret.ts` (cron secret /
      service-role bearer / signed-in editor) on 17 cron+UI functions, `requireEditor`
      on 17 UI-only, `requireUser` on `sla-ticket-analyze`.
- [x] Cron credential migration — all 20 edge-function jobs re-registered onto
      `public.esh_cron_headers()`; audit shows `uses_secret=true`, `still_has_anon=false`.
      Retired `sync-inbox-v2-frequent` / `sync-inbox-v2-nightly` (V2 data set unused).
      Post-rewrite runs healthy, `consecutive_failures=0` across `integration_health`.
- [x] VERIFIED 2026-09-02 21:44 UTC: all 5 daily-only jobs (poll-slack-closed-won,
      sync-parahelp-routing, publish-registry-notion, sync-intercom-fields,
      sync-linear-escalations) fired successfully under the new cron header;
      `consecutive_failures=0` across `integration_health`.
- [x] VERIFIED 2026-09-02: signed-in editor invocation of the 5 newly gated
      functions returns 200; the same calls with no token return 401.
- [ ] Real Google OAuth round-trip (Gmail reconnect) — UNVERIFIED by choice. Reconnect
      replaces the token row with whichever account consents, and the current connected
      account (`epx-reporting@lovable.dev`) is not Matt's; he is tracking down its owner.
      Negative cases (missing / unknown / consumed / expired state, unauthenticated
      `gmail-auth-url`) are all verified.
- [x] VERIFIED 2026-09-02 21:54 UTC: security rescan clean — 0 critical, 0 error;
      only the known intentional warn (signed-in execute on SECURITY DEFINER).
      Published.


## Next session (deferred 2026-09-01 by Matt)

- [ ] Display pass for the persisted resolution clocks — REMIND MATT AT START OF NEXT SESSION
  - Now a FOUR-way split (engine v3): active / customer wait / engineering wait / closed
  - Analytics v3: add the four-way sub-line under resolution
  - Trend report: four-way split in the resolution tooltip
  - Resolution anatomy: switch from client-side derivation to the persisted columns
    (`resolution_active_s`, `resolution_customer_wait_s`, `resolution_eng_wait_s`,
     `resolution_closed_s`, `resolution_window_s`)
  - Escalations board: surface `eng_wait_start_at` / `eng_wait_end_at` per linked ticket
  - Doc pass after: project-knowledge via sync-knowledge-pending, changelog row, FlowDiagram node

## Multi-Linear escalations (raised 2026-09-02 by Matt)
- [ ] One Intercom ticket can carry MORE THAN ONE Linear issue (e.g. 215475479744265:
      ENT-3478 in the `Escalated Issue` attribute + ENT-3798 posted only as a note).
      Today: `dev_escalations` is one row per conversation and the eng-wait window
      only covers the attribute-linked issue, so a second escalation's wait is
      misfiled as customer wait. Decide: (a) leave as-is, (b) allow N escalation
      rows per conversation and union their windows, (c) primary + secondary links.

## Watch (engine v3)
- [ ] `eng_wait_source` fallbacks `dev_escalation_row` and `linear_created` are UNVERIFIED —
      all 30 live rows resolved via `attribute_event`.

## Performance (2026-09-02)
- [x] Items 1-3 (batched dedup, throttled health writes, settings cache) — deployed.
- [x] Item 4 — coverage served from snapshots: `public.v3_coverage_cached(max_age_minutes)`
      returns the persisted snapshot, recomputing at most hourly. Customers Coverage +
      Unattributed tabs call it instead of `v3_coverage_current()` (was ~2.3s/call, 249 calls).
- [x] Item 5 — `intercom_sync_jobs_v3 (kind, status, finished_at DESC) WHERE finished_at IS NOT NULL`
      for the Action Center staleness probe.
- [x] Root cause of memory pressure: heap bloat. `intercom_tickets_v3` was 95 MB heap for
      668 rows; VACUUM FULL took it to ~1 MB (total 140 MB -> 8.8 MB). Also compacted
      esh_search_index, inbox_v2_tickets, v3_ticket_attributes, intercom_sync_jobs_v3.
      Autovacuum scale factors tightened (0.02-0.05) on those tables to stop regrowth.
      Result: memory 70% -> 60%, disk 24% -> 22%. No resize needed.
- [ ] Doc pass for the coverage-cache change (project knowledge, changelog row, FlowDiagram node).

## Reporting metric standardization (2026-09-03)
- [x] Persist responsiveness metrics — migration 0032, `computeResponsiveness()` in
      `_shared/sla-core.ts`, written at finalize, `backfill-v3-responsiveness` deployed.
- [x] `src/lib/reportingMetrics.ts` — population predicate, metric registry, aggregation.
- [x] Conform Owner dashboard v3 (was raw wall clock) and Monthly lookback
      (triage + human first reply headlines; any-agent reply demoted to context).
- [ ] **RUN THE BACKFILL** — click "Backfill responsiveness" on the Inbox v3 sync card
      (editor-gated; the agent cannot mint an editor session). Until then every
      responsiveness column is NULL and the new cards show em dashes.
- [ ] Verify after backfill: August old-vs-new delta, population reconciliation,
      negative cases (never-triaged, Sam-only tickets). Currently UNVERIFIED.
- [x] Doc pass — project knowledge, changelog row 2026-09-03, FlowDiagram node.

## Open by choice
- [ ] Security batches 4 and 5 (deliberately unstarted)

## Incidents in the hub (2026-09-04, approved plan)
- [ ] BACKLOG: incident.io API connection (Matt's call, 2026-09-04: do not connect
      yet). Matt will ASK the two owners of the existing incident.io workspace
      connection for permission before we assume we may use it.
- [x] Source decided: poll the #incidents Slack channel C07TMQ5E6SC instead.
- [x] `incidents` table + RLS/GRANTs (migration 0033).
- [x] `poll-slack-incidents` edge function: reads C07TMQ5E6SC on a rolling
      window, parses the incident.io announcement blocks, upserts by incident
      reference, integration_health key `slack_incidents_poll`. Deployed 2026-09-04;
      full backfill loaded 1049 incidents. Cron still to schedule.
- [x] Live banner in AppLayout (status category `live` only), 60s refresh, session-only dismissal, silent on read failure.
- [x] `/incidents` sortable log page + nav entry + CSV export.
- [x] Customer-impacting: derived from the public status-page link present in the
      Slack announcement (the API could not give this — both status-page
      endpoints 404).
- [x] Parser handles all three announcement formats (current, terminal/declined
      with quoted title, pre-Oct-2025 emoji-only). Rescan: 1049 upserted, 0 errors,
      1008 closed / 10 live / 6 post-incident / 25 unknown (all Jan-Feb 2025).
- [ ] **SCHEDULE THE CRON** (Matt, SQL editor — agent SQL is refused on cron.*):
      every 5 min, POST poll-slack-incidents with {"lookbackDays": 2} using
      public.esh_cron_headers(). Until then the feed is static at the backfill.
- [x] Doc pass 2026-09-04: knowledge doc updated + staged via sync-knowledge-pending
      (200 ok, 319,586 chars — approve on /knowledge), changelog rows 2026-09-04
      (incident feed + "Incidents page defaults to live"), FlowDiagram node updated.
- [ ] UNVERIFIED: banner and /incidents not yet loaded in a browser at ultrawide.
