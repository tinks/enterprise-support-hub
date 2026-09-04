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

- [x] Display pass for the persisted resolution clocks — DONE 2026-09-04 (Analytics v3,
      Trend report and Resolution anatomy landed 2 Sep; escalations eng-wait window 4 Sep;
      doc pass done). UNVERIFIED: the "still open at close" branch (all 37 windowed rows
      have an end).
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
- [x] Doc pass for the coverage-cache change — DONE 2026-09-04 (knowledge staged via
      sync-knowledge-pending 200 ok, changelog row, FlowDiagram node; combined with the
      responsiveness-verification doc pass).

## Reporting metric standardization (2026-09-03)
- [x] Persist responsiveness metrics — migration 0032, `computeResponsiveness()` in
      `_shared/sla-core.ts`, written at finalize, `backfill-v3-responsiveness` deployed.
- [x] `src/lib/reportingMetrics.ts` — population predicate, metric registry, aggregation.
- [x] Conform Owner dashboard v3 (was raw wall clock) and Monthly lookback
      (triage + human first reply headlines; any-agent reply demoted to context).
- [x] Backfill run 2026-09-03 by Matt: processed 611, written 611, failed 0, remaining 0.
- [x] VERIFIED 2026-09-04 21:2x UTC (SQL, no code change):
      * Population reconciliation, Aug 2026 (created_at in Aug): 243 rows created ->
        232 after transferred_out + test-ticket -> **179 SLA reporting population**
        (rsa_override=false, RSA_FALSE_TAGS, merged_ticket, excluded resolution
        methods). Of those 179, 156 carry a responsiveness stamp; the 23 unstamped
        are non-finalized (14) or finalized outside the backfill window (9).
      * Aug medians on the 179-row population: triage 3m35s (n=155),
        first HUMAN reply 11m58s (n=153), any-agent reply 17m19s (n=153).
        P90: triage 4h58m, human reply 8h23m.
      * Old-vs-new delta: the retired card read any-agent reply over the broader
        232-row volume population = 14m17s. New headline (human reply, SLA
        population) = 11m58s. The gap is definition + population, not a regression.
      * Negative cases exercised: 281 stamped rows never triaged (NULL, not 0);
        90 with no human reply, of which 65 had no admin reply at all and 25 were
        agent-only. Spot-checked 215475758268164 against its raw timeline: the
        only public comment was Sam's; Matt set attributes and closed but never
        replied publicly — NULL human reply is correct, not a miss.
      * responsiveness_engine_version: single value (1) across all 611 rows.

- [x] Doc pass — project knowledge, changelog row 2026-09-03, FlowDiagram node.
- [x] Verification doc pass 2026-09-04: Aug reconciliation + negative cases written into
      project-knowledge (staged via sync-knowledge-pending) and a changelog row.

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
- [x] Cron scheduled 2026-09-04 by Matt in the SQL editor (agent SQL + migration
      tool both refuse HTTP cron here): job poll_slack_incidents_15min,
      '*/15 * * * *' (96 runs/day), net.http_post → poll-slack-incidents with
      public.esh_cron_headers(), body {"mode":"rolling"}, 60s timeout. 15 min
      chosen over 5 min to avoid keeping the DB awake for no work; worst-case
      banner lag 15 min. Job exists in the DB only — NO migration file.
      First fire 21:45:06 UTC verified: health ok, 0 failures, 7 rows re-stamped,
      1049 → 1050 incidents.
- [x] Doc pass 2026-09-04: knowledge doc updated + staged via sync-knowledge-pending
      (200 ok, 319,586 chars — approve on /knowledge), changelog rows 2026-09-04
      (incident feed + "Incidents page defaults to live"), FlowDiagram node updated.
- [ ] UNVERIFIED: cron.job / cron.job_run_details are permission-denied to every
      agent role, so the schedule row and multi-fire recurrence were never read
      back directly — only the single successful :45 fire.
- [ ] UNVERIFIED: banner and /incidents not yet loaded in a browser at ultrawide.
