# Archive: resolution anatomy rollout notes

Historical narrative and verification logs relocated out of `.lovable/project-knowledge.md` on 22 Sep 2026. Text is verbatim; line references are to the pre-trim file (2,697 lines).

## L2223

**Verified 31 Aug 2026** (3 months, >7d, 164 tickets, 0 reconciliation failures, pre-closed-bucket): our clock 25% (584d) vs their clock 75% (1760d); median time to first close 9d 22h vs last close 12d 0h; 136 of 164 closed with no customer reply after our last message; 48 reopened at least once. Worst areas by volume: Account Access and Permissions (24), SSO/SCIM/SAML (19).

## L2225

**Verified 31 Aug 2026 (closed bucket):** 12 unit tests in `src/lib/__tests__/resolutionAnatomy.test.ts` pass, including a case where a 30-day closed stretch is fully attributed to `closedS` and reconciliation still holds. **UNVERIFIED:** the re-rendered population shares with the closed bucket live (the earlier 25/75 split above predates it), and silent drift, which previously read 0% across the cohort — some of what used to look like "nobody owed" or "we owed" now lands in `closed`, and the split should be re-read before it is quoted again.

## L2293

**Verified 1 Sep 2026** (August, ultrawide viewport): 242 created / 181 population / 146 closed / 35 open / 94% categorised; theme mix renders over 146 closed against 138 in July with no `— not set —` inflation; median resolve 82.8h vs 91.4h, P90 265.9h vs 446.7h, reopens 13% vs 20%, CSAT 4.47 (n=17). Four-field coverage over the 197 finalized August tickets: Severity 193, Affected Product Area 190, Ticket type 190, Escalated to Engineering 186 (154 No / 32 Yes / 11 unset). The closed tickets missing area or type were bulk-closed through an automated path that bypasses the mandatory closure form. **UNVERIFIED:** per-section note saving and the copy-out under a read-only role; the Slack summary and the plan-scope switch have not been re-verified since the four-field leak change.

## L2326

**Backfill run + verified (3–4 Sep 2026).** The backfill processed 611 finalized rows, wrote 611, failed 0, remaining 0; all 611 carry `responsiveness_engine_version = 1` (no version skew). SQL reconciliation for **August 2026** (created_at in Aug): 243 rows created → 232 after `transferred_out` + test-ticket exclusion → **179 SLA reporting population** (after `rsa_override = false`, `RSA_FALSE_TAGS`, merged tickets and excluded resolution methods). 156 of the 179 carry a responsiveness stamp; the 23 unstamped are non-finalized (14) or finalized outside the backfill window (9). Aug medians on that population: **triage 3m35s** (n=155), **first human reply 11m58s** (n=153), any-agent reply 17m19s (n=153); P90 triage 4h58m, human reply 8h23m. **Old vs new:** the retired card read any-agent reply over the broader 232-row volume population = 14m17s, against the new headline 11m58s — the gap is definition + population, not a regression. **Negative cases exercised:** 281 stamped rows never triaged (NULL, never 0); 90 with no human reply, of which 65 had no admin reply at all and 25 were agent-only. Conversation `215475758268164` was spot-checked against its raw timeline — Sam posted the only public comment while Matt set attributes and closed without replying, so NULL is correct. **Still UNVERIFIED:** nothing has re-run through `computeResponsiveness()` at finalize since the backfill, so the live finalize path is proven only by the backfill's shared code path.

## L2334

**Verified 1 Sep 2026 against SQL.** Analytics v3 September: n=21, median active 3h 13m (SQL 3.21h), raw median 3d 19h (SQL 91.4h), 1 at zero active — exact match. Trend report: Jun 2h 27m / Jul 1h 25m against SQL 2.45h / 1.42h. Monthly lookback August: median active 2h 19m against 2h 18m over a hand-rebuilt exclusion predicate (150 closed in SQL vs 154 on the page). Population-wide since June 1 2026 the median moved from **96.67h raw to 2.25h active**.

## L2338

**UNVERIFIED:** the SQL replication of `src/lib/slaExclusions.ts` used for the Monthly lookback cross-check is approximate (4-ticket delta); 2 finalized rows remain not computable and are excluded from every median.

## L2350

**Verified 1 Sep 2026** after a forced re-backfill of all 592 finalized rows: identity violations **0**; nulls unchanged at **2** (the same not-computable rows); `resolution_active_s`, `_bh_s` and `_closed_s` byte-identical to their pre-backfill snapshot on all 592 rows (**0 changed**) — the refactor did not move the existing metric. Population medians: **active 2.25h vs customer wait 49.97h**; totals **2,417.7 ticket-days of customer wait vs 86.8 ticket-days of closed time**, confirming the residual was dominated by customer wait and never a safe proxy.

## L2364

**Verified 1 Sep 2026** on a forced re-backfill of all 592 finalized rows (engine version 1→3): identity violations **0**; `resolution_active_s` and `resolution_closed_s` byte-identical to their pre-backfill snapshot on all 592 rows (**0 changed**); **30 tickets** carry engineering wait totalling **3,542.3h**, moved out of customer wait (58,023.8h → 54,481.4h, exactly the 3,542.3h delta). All 30 resolved via `attribute_event`; no row used the `dev_escalation_row` or `linear_created` fallback, so **those two branches are UNVERIFIED on live data**. Negative case checked: of 34 finalized tickets with a Linear reference, the **4** at zero are each explained — three had the attribute set after the ticket closed (1h22m, 9 days, and a month later) and one (ENT-2804) had the Linear issue completed three days before the reference was recorded.

## L2380

**Verified 2 Sep 2026.** `sync-linear-escalations`: 49 candidates → 45 distinct keys → **44 link rows** written, 43 primary rows, 5 keys not found in Linear (pre-existing, unrelated teams). Forced re-backfill of all finalized rows: **596 at engine version 3**, identity violations **0**, engineering wait unchanged at **3,542.3h across 30 tickets**. `215475479744265` now carries both links (ENT-3478 Done, ENT-3798 In Review) and its eng wait stays **408,352s** — correctly, because ENT-3798 was created 1 Sep, *after* the 31 Aug close, so its window clamps to zero. The union path therefore has **no live row yet where two windows both contribute** — that branch is **UNVERIFIED on live data**.

## L2434

**Verified 4 Sep 2026** at 2560px on `215475479744265`: eng wait **6d 19h**, envelope 14 Aug 18:53 → 3 Sep 17:09 (`attribute_event`), per-issue rows ENT-3478 (14 Aug → 19 Aug, Done) and ENT-3798 (1 Sep → still open, In Review). Detector verified with a temporary note carrying `ENT-9999` on the same ticket — banner read "1 escalation mentions…" and the detail field listed ENT-9999 — and the note was deleted afterwards. **UNVERIFIED:** the live note-only population is **0** rows (no `intercom_v3` note contains a Linear key today), so the detector has never fired on real data.

## L2437

**Verified 2 Sep 2026.** Typecheck and build clean. Against the live table across all finalized rows: **599** carry a full split, **2** do not (reported as "without split"), **0 identity violations** (`active + customer + eng + closed = window` within 2s). Population shares: active **23.0%** · customer wait **69.9%** · engineering wait **4.4%** · closed **2.7%**.

## L2439

**UNVERIFIED.** The four pages were not loaded in a browser at ultrawide width in this pass — verification was typecheck, build and the SQL reconciliation above only.

## L2494

**Verified 9 Sep 2026.** `ACTIVE_CLOCK_ENGINE_VERSION` bumped 3 → 4 and all **656** finalized/reopened rows re-backfilled (500 + 156, `failed 0`, `skipped_no_parts 0`, `remaining 0`). Post-state: **uncomputable 0** (was 2), **identity violations 0**, `outbound_initiated` **3**, outbound-only **2**.

## L2499

**UNVERIFIED / open.** The pre-backfill values of the third outbound row were not snapshotted, so its active-second delta from the ownership change is not quantified. `215475476004105` is an internal allowlist request, not a support problem; Matt proposed classifying it **Enterprise FYI** and excluding it from issue-based SLA/resolution reporting — **not applied**, awaiting his call.
