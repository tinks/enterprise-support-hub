## Self-serve enterprise (SSE) as a first-class reporting cut

SSE is already plumbed at ingest: `settings.sse_intercom_inbox_id` is set (11433093), and every v3 ticket carries `plan_tier` (`enterprise` | `sse`). Today: 639 enterprise, 3 SSE rows. The SLA engine already resolves an SSE policy — no first-response commitment, 1h triage — and Triage shows an SSE badge and per-row target.

What is missing is everything downstream: no report scopes by plan except Monthly lookback, Inbox v3 has no way to see or filter plan, and the Action Center suppresses SSE entirely (`SUPPRESS_SSE = true`), so once real SSE volume arrives nobody is watching its triage clock.

This plan closes those three gaps.

### 1. Find them: plan is a visible, filterable dimension

- Inbox v3: a **Plan** column (Enterprise / SSE badge, same visual language as Triage) plus a plan filter alongside the existing owner/area filters, applied on all three tabs.
- Deep search and owner dashboards v3: plan badge on rows so a result is never ambiguous.
- Triage: unchanged — it already badges plan and applies the 1h SSE target.

### 2. Report them: one shared plan scope control

Monthly lookback's `planScope` selector (All / Enterprise / SSE) is the pattern. Lift it into a shared component + hook and add it to: SLA report, CSAT report, Trend report, Analytics v3, Resolution anatomy, Owner dashboard v3.

Scope defaults per surface, because the right default differs:

- **SLA report, SLA workbench, SLA dashboard** default to **Enterprise only**. SSE has no first-response SLA, so mixing it into compliance rates understates them. SSE is selectable, and when selected the report shows triage + cadence sections only, with SLA panels replaced by an explicit "no SLA commitment on this plan" note rather than 0%.
- **Volume, CSAT, trend, resolution, monthly lookback** default to **All**, with the plan cut shown as a breakdown row so the mix is visible without switching.

Every export (CSV, narrative, Slack summary) states the active scope, as Monthly lookback already does.

### 3. Watch them: Action Center becomes plan-aware, not SSE-blind

Replace the blanket `SUPPRESS_SSE` filter with per-signal plan handling:

- Missing severity, unassigned queue: include SSE.
- First-response risk: enterprise only, permanently — there is no SSE first-response target to breach.
- New **SSE triage risk** signal: open SSE tickets past the 1h triage target, using the same policy resolution Triage uses.

Each signal keeps its existing mute toggle, so SSE alerting can be turned off while the inbox is still shaking out.
