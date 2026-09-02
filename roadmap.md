# Roadmap

## Blocking publish (top priority next session, 2026-09-01 by Matt)
Three critical scanner findings block the publish gate. Batch B work, scoped:
- [ ] `gmail_oauth_hijack` — gate `gmail-auth-url` behind `requireEditor`; add a
      server-stored single-use `state` nonce verified in `gmail-oauth-callback`
      before deleting/replacing the `gmail_oauth_tokens` row.
      (Also fixes the `Index.tsx` "not connected" indicator via a definer RPC.)
- [ ] `open_data_read_fns` — add `requireUser` to: search-intercom-by-email (done),
      list-slack-users, list-slack-channels, fetch-thread-messages,
      fetch-gmail-thread, intercom-month-stats, check-bot-identity.
      All UI-invoked; no cron callers. Verify each from the UI after gating.
- [x] `open_mutation_fns` — dual-caller gate shipped 2026-09-02: `_shared/require-editor-or-secret.ts`
      (cron secret header `x-esh-cron-secret` from `public.cron_auth` / service-role bearer /
      signed-in editor) applied to 17 cron+UI functions. PENDING MATT: run
      /mnt/documents/cron-secret-header-rewrite.sql so the 22 cron jobs send the secret
      instead of the anon JWT, then confirm next runs in Integration Health.
- [ ] `open_mutation_fns` (original note) — per-function caller inventory FIRST (cron/webhook vs UI).
      UI-invoked → `requireEditor`. Cron/webhook → shared-secret header (cron) or
      existing signature verification (Slack/Intercom). Do NOT blanket-apply:
      poll-*, sync-v3-*, reconcile-v3-open, context-reminder,
      integration-health-alert, publish-registry-notion carry no user JWT and
      would fail silently as stale data.
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
