# Archive: Intercom write-spine rollout notes

Historical narrative and verification logs relocated out of `.lovable/project-knowledge.md` on 22 Sep 2026. Text is verbatim; line references are to the pre-trim file (2,697 lines).

## L1749-1751

### Verification for this step

Positive: set severity from the sheet on a test-account ticket, then on one real triage ticket watched through close. Negative: kill switch off ⇒ inline refusal, no local change, `esh_ticket_actions` row with `outcome = blocked`. Both confirmed against Intercom by re-read before the step counts as done.

## L1933-1935

### Verification (17 Aug 2026)

Positive path only: `/users` renders the editor controls, `/triage` and `/changelog` render for an editor+admin account, typecheck clean at 1900px. **UNVERIFIED:** the read-only branch — `EditorRoute` card, `ReadOnlyBanner`, RLS refusal — because no account without `editor` exists yet.

## L1956-1958

### Verification status

Code deployed; **NOT yet exercised live**. Pending: allowlist entry, then the three negative tests (not-allowlisted refusal, stale-value 409 on a field changed in Intercom after page load, unmapped-teammate refusal) plus one live write/revert on a designated test ticket.

## L1982-1988

### Verification (18 Aug 2026)

- Cache holds 20 active `Affected Product Area` options and 6 `Ticket type` options, read live from Intercom.
- Settings card renders both, and the Product Area drift (18 in `settings.product_areas` vs 20 in Intercom) is shown, not smoothed.
- Negative tests run live against the write endpoint: a legacy-list-only product area (`SSO`) → `400 {blocked:true}` "must be one of the options Intercom offers"; an invented ticket type → `400 {blocked:true}` listing the six cached values. Earlier the same day, the stale-value `409` and not-allowlisted `403` paths were also exercised live.
- **UNVERIFIED:** the empty-cache refusal branch (no run has ever seen an empty cache) and a successful `set_product_area` / `set_classification` write of a cache-only value that does not exist in `settings.product_areas`.
- Note surfaced, not fixed: some historical tickets carry `product_area` values (e.g. `Remix/transfer`) that are **not** in Intercom's current active option list. Writes can no longer produce them; existing rows are untouched.

## L2031-2035

### Verification (18 Aug 2026)

- Live proposal on Intercom #215475026117090: Severity 4, high confidence, rubric v1, 685 input / 86 output tokens.
- Dedup proven: an immediate identical re-run returned `calls: 0`, `skipped: "unchanged"`, no model call.
- **UNVERIFIED:** the kill-switch-off refusal, the daily-cap refusal, the unknown-ticket-id branch, and the accept → `recordSeverityDecision` → `accepted`/`overridden` round trip through the UI. None of these has been exercised live.

## L2053-2057

### Verification (19 Aug 2026)

- `run-severity-eval` `{ n: 3, pass: "triage" }` → `scored: 3`, `failed: 0`, rubric v2. Outcome: 1 agreement (Sev 3 = Sev 3), 2 disagreements (AI 4 / ticket 2, AI 2 / ticket 3) left `pending` for human adjudication.
- `backtest-severity` correctly refused with `400 "No backtestable cases yet — a case needs a stored ticket excerpt and a human severity."` — no decided proposal carries an `input_excerpt` yet, since excerpts only start accruing on proposals made from now on.
- **UNVERIFIED:** the override reason prompt end-to-end through the UI, the backtest path sourced from adjudicated `ai_wrong` showdown items, and the daily-cap refusal on `run-severity-eval`.

## L2077-2079

### Verification status

Typecheck clean. **UNVERIFIED live**: no multi-field write, no partial-failure case, and no stale-409 case has been exercised against a real ticket since the panel replaced the per-field buttons.

## L2100-2102

### Verification status

Verified live on Intercom #215474865211089: set via SQL and rendered in Inbox v3 with the `edited · Intercom:` subline; then edited **through the UI** to a new label and cleared through the UI, with both actions landing in `conversation_audit_logs` under the acting editor's email and the row falling back to Intercom's subject. Typecheck and build clean. **UNVERIFIED**: the read-only refusal path (an `editor`-less account attempting a save) has not been exercised.

## L2127-2129

### Verification status

Verified 9 Sep 2026: #215475214997973 titled "Lovable app backend migration from EU to US"; an immediate re-run reported `modelCalls: 0` (hash skip); kill switch off returned 403; unauthenticated returned 401 and a bad cron secret returned 401; the open-only backfill wrote 19 rows and left the 263 closed placeholders at exactly 263, with `subject_ai` on closed tickets = 0. Typecheck and build clean.

## L2135

**UNVERIFIED / NOT DONE**: the tail hop has not yet fired live — it was deployed with 0 open placeholders pending, so it has had no work to do; the next placeholder ticket exercises it and leaves a log line. The read-only refusal path for the AI buttons has not been exercised, and the daily-cap refusal has not been hit.

## L2155-2157

### Verification status

Guard logic and call-site placement reviewed in code; build clean. **UNVERIFIED**: no live ticket has yet arrived with a reserved-character contact email, so the rejection branch has not been exercised against production data.
