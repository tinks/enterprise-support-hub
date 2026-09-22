# Archive: verification logs

Historical narrative and verification logs relocated out of `.lovable/project-knowledge.md` on 22 Sep 2026. Text is verbatim; line references are to the pre-trim file (2,697 lines).

## L700

- Verified against Matt: 21 active / 146 closed, matching direct SQL over the same predicate.

## L906

**Status: VERIFIED (27 Aug 2026).** The job fired at **05:00:07 UTC** on its first scheduled occurrence; `integration_health.notion_registry_publish` = `ok`, no failure recorded. It was a **real write, not a no-op**: `notion_registry_changed_at` equals `notion_registry_synced_at` (05:00:07), so the domain set had changed and the page was rewritten — **504 domains**. Negative case that makes pg_cron status the only honest signal in general: an unchanged registry writes nothing to Notion and only re-stamps the hash, so a healthy no-op morning is indistinguishable from a skipped run in `integration_health` alone.

## L1239

**UNVERIFIED:** no SSE inbox id is configured yet and no SSE ticket exists, so the ingest path, the `sse` policy resolution and the SSE triage band have **not** been exercised against real data — only unit-tested and type-checked (118 SLA tests green).

## L1254

**UNVERIFIED:** 3 SSE tickets exist at time of writing, so the SSE-scoped report panels and `sse_triage_risk`'s non-zero path have not been exercised at volume; type-check green, no runtime check of the non-zero triage-risk branch.

## L1456

- **VERIFICATION (24 Aug 2026):** SQL over the 50 open/reopened tickets — 0 missing Severity, 0 missing assignee/owner (raw and after exclusions). Both queues are legitimately empty in steady state, so the NON-ZERO path of the unassigned queue and its Action Center card is **UNVERIFIED** against live data.

## L2181

**Verified 31 Aug 2026:** 997 rows indexed (629 v3 tickets, 253 customers, 43 backlog, 42 escalations, 25 notes, 5 severity proposals). `SCA-3522` returns the escalation and Intercom ticket #215475673305527 (matched from the message body). **UNVERIFIED:** the hourly cron firing in production, and phrase-query result quality at scale.

## L2197

**Verified 11 Sep 2026:** topic `GitHub`, last 90 days → 64 tickets matched, 64 analysed, 8 themes (largest: "Synchronization failures and non-destructive recovery", 9 tickets, bug), monthly volume 3 / 16 / 27 / 18 for Jun-Sep 2026. **UNVERIFIED:** behaviour above the 120-ticket cap (truncation notice path), and the 402/429 gateway-error branches.

## L2255

**Verified 31 Aug 2026:** sync run live; `7723970` resolves to **Product Experience Specialists** and renders on the Transferred tab. **UNVERIFIED:** the `active=false` retirement path (no team has disappeared yet) and the cache-miss fallback (every id currently present resolves).

## L2524

**Verified.** Slack post, permalink capture, Intercom internal note, idempotent repeat click, and the 401 / invalid-mode 400 / missing-row 409 negative cases were all exercised on conversation `215475870430467`. **UNVERIFIED:** the kill-switch-off refusal, the forced note-failure Retry path, and the new real-mention post actually waking Pax (the mention change was deployed and the id stored, but no post-fix run has been observed).

## L2532-2533

- **Verified live (10 Sep 2026)** on conversation `215475881886059`: OAuth consent completed and the UI reported "Your Slack account is connected"; the `#pax-ets-help` post (`C0BD2BQA63G`, permalink `.../p1789055344830919`) was authored by the human account, not the bot; **Pax replied and began investigating**; `pax_investigations.note_state = 'linked'` with no note error; the Intercom internal note was attributed to Matt's admin id `10765619`; `esh_ticket_actions` recorded `ask_pax_investigate` = `succeeded`; and re-opening the ticket rendered the existing thread + note state instead of the Ask button.
- **UNVERIFIED:** a second server-side `mode="start"` call on an existing row (UI-level idempotency was observed, the function path was not re-exercised in the human flow), the reconnect-after-expiry path, disconnect, the non-roster / no-connection `409 slackConnectRequired` refusal, the kill-switch-off refusal, and the forced note-failure Retry path.

## L2562

**Verified 10 Sep 2026** at 1920px: `/my-queue` defaulted to Matt and rendered 26 open tickets — 7 Action needed, 0 Waiting on engineering, 5 Ready for follow-up, 10 Waiting on customer, 4 No activity data, 4 with missing fields. **UNVERIFIED:** the teammate switcher for another owner, and the non-zero Waiting-on-engineering bucket (no open ticket currently has an engineering wait clock).

## L2585

**Verified 11 Sep 2026** at 2000px on Matt's queue: 5 Action needed, 3 Dev resolved (SCA-3522, IAM-576, ENT-3735 — all Linear Done, all "needs sign-off"), 2 Waiting on dev both Chase due (CLO-1225 In Progress / James Gibbs, CLO-1074 Backlog / unassigned), 1 Ready for follow-up, 6 Waiting on customer, 0 No activity data. **UNVERIFIED:** the write paths (Mark followed up, quick-pick overrides, custom date, Acknowledge dev fix / Undo) have not been exercised against live data; the read-only (non-editor) branch is likewise untested.

## L2595

**Verified 11 Sep 2026** at 2000px, live writes on Matt's queue: setting it on CLO-1074 (Backlog, unassigned) moved the ticket from Waiting on dev + Chase due to Ready for follow-up (Waiting on dev 2→1, Chase dev 1→0) with the note and who/when rendered; setting it on SCA-3522 (Linear Done) left it in Dev resolved with *Acknowledge dev fix* still offered — the negative case. Both flags were cleared afterwards; `select … where dev_workaround_at is not null` returns 0 rows. **UNVERIFIED:** the read-only (non-editor) branch.

## L2613

**Verified 11 Sep 2026** at 2000px on live My Queue tickets: collapsed panel, pencil-expanded editor, a ticket with no escalation (card correctly absent), and both message cards rendering with expansion. No horizontal scroll.

## L2648

**Verified 11 Sep 2026** at 1800px on Matt's live queue: 215475781288266 renders the amber *Latest internal note* card with Matt's 8 Sep text while *Latest reply* still shows Diana's 4 Sep message; a live **+1w** write set 18 Sep 2026, incremented Snoozed 0→1, dimmed the row and sank it to the bottom of the table while it stayed *Action needed*; **Wake now** cleared all four columns and restored its position. **UNVERIFIED:** the Custom date popover path and the read-only (non-editor) branch.

## L2661

**Verified 16 Sep 2026** on live data: test ticket 215475949159138 (snoozed 15 Sep → 18 Sep, customer replied 16 Sep) rendered *Woken automatically — the customer replied after this was snoozed* in My Queue and dropped out of the snoozed set; a live `sync-v3-open` run (`windowHours: 72`) returned `snoozes_woken: 2` and the ticket's four snooze columns are now NULL. **UNVERIFIED:** the Linear-resolution wake path (no snoozed ticket with a freshly-resolved issue existed at build time) and the read-only (non-editor) branch of the woken card.

## L2677

**Verified 16 Sep 2026** on live data: 2 tagged tickets (1 open Mews `215475962771162`, 1 closed), save path wrote a category + note attributed to `matt.niiro@lovable.dev`; the test row was deleted afterwards. **UNVERIFIED:** the non-editor read-only branch and the `Sam - Avoid` scope at volume.
