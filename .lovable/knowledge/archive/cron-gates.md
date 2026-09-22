# Archive: cron gating and scheduled-job verification

Historical narrative and verification logs relocated out of `.lovable/project-knowledge.md` on 22 Sep 2026. Text is verbatim; line references are to the pre-trim file (2,697 lines).

## L149

**Status.** Negative: anonymous and bogus-secret POSTs 401 on 10 sampled functions; all five Gmail state failure modes rejected. Positive: `net.http_post` with `esh_cron_headers()` → 200; post-rewrite scheduled runs healthy (`consecutive_failures = 0` on every `integration_health` row) and a `cron.job` audit shows `uses_secret = true` / `still_has_anon = false` for all 20 jobs. UNVERIFIED: daily-only jobs have not yet fired under the new header; the real Google OAuth round-trip; signed-in editor "Run now" buttons on the newly gated functions.

## L1817-1819

### Verification state (14 Aug 2026)

All ten signals load and read 0, cross-checked against SQL — 44 open tickets, 0 untriaged, 0 escalations, 0 Parahelp pending, 0 pending docs, 0 unhealthy integrations. The zeros are real, not an over-filtered query. **Not yet observed:** the non-zero path (amber card + rail badge) against live data, because every watched queue is currently empty.

## L1844-1848

### Verification (14 Aug 2026)

- **Negative:** all 7 guarded endpoints return `401` with no `Authorization` header **and** with the anon key alone.
- **Positive:** `list-slack-channels`, `list-slack-users`, `check-bot-identity` all return `200` with a real user session token.
- **XSS:** `gmail-oauth-callback?error=<script>alert(1)</script>` renders escaped entities.

## L1876-1880

### Verification (17 Aug 2026)

Negative: 401 with no `Authorization` header and with the anon key alone; explicit refusals for a gmail.com address, self-block, unknown roster row, duplicate provision. Positive: test row `esh-access-test@lovable.dev` (mine) added and provisioned through the UI at 1900px, then blocked — `hub_members` shows `blocked` with `user_id` null and `auth.users` has 0 matching rows.

Merge check (17 Aug 2026): `/users` at 1900px renders exactly one table with 11 rows, matching SQL (11 `hub_members` + 0 untracked accounts). A temporary `pending` row (`zz-verify-pending@lovable.dev`, mine, deleted afterwards) rendered Provision + Remove access with role buttons replaced by "no account yet". Still unproven: the `untracked` row branch (no such account exists) and the last-admin disabled tooltip (two admins exist; no real admin was revoked to force it). Also still unproven: a real first-time workspace member completing the sign-in path against a provisioned account.
