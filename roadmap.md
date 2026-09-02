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
- [ ] UNVERIFIED, watch: daily-only jobs (poll-slack-closed-won, sync-parahelp-routing,
      publish-registry-notion, sync-intercom-fields, sync-linear-escalations) have not
      yet fired under the new header. Check Integration Health tomorrow.
- [ ] UNVERIFIED: signed-in editor "Run now" buttons on the newly gated functions.
- [ ] Re-run the security scan, then publish.

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

## Open by choice
- [ ] Security batches 4 and 5 (deliberately unstarted)
