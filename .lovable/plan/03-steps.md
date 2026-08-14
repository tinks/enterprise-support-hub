## The steps

Each is one shippable chunk. None starts before the previous one's negative test has passed.

**Step 0 — Actor mapping (prerequisite, no user-visible change).** Add an Intercom admin ID to `teammates` for every active support person, alongside the Slack IDs already there. Nothing writes yet; this just makes every later write attributable to a human. Verified by listing Intercom admins and matching all five active support teammates.

**Step 1 — Write spine.** One new edge function, `esh-write-action`, and one new table, `esh_ticket_actions` (append-only audit: who, ticket, action, payload, Intercom response, outcome). Plus a global kill switch in `settings` and a per-action allowlist. The function supports exactly one action initially and refuses everything else. Nothing in the UI calls it yet — this step is proven by curl, including a rejected call with the switch off.

**Step 2 — Severity from the Triage queue.** The first real write, on the surface you picked. Setting severity on a triage row calls `esh-write-action`, which writes the Intercom custom attribute, re-reads the conversation, and updates the local row. Available to all support teammates; kill switch live. This is the smallest possible write: one field, one enum, on tickets that by definition have no value yet, so there is nothing to overwrite. Success looks like the ticket leaving the triage queue on the next refresh because Intercom itself now reports a severity.

**Step 3 — Owner and product area.** Same path, two more fields, same surface plus the Inbox v3 detail sheet. Adds the first conflict case (a field that may already have a value), so the write includes an "expected current value" check and refuses if Intercom moved underneath you.

**Step 4 — Internal notes.** First write that produces a visible artifact in Intercom for other people. Posts an admin note attributed to the acting teammate. Low risk (notes are not customer-facing) but exercises the full attribution path that replies will depend on.

**Step 5 — Tags and lifecycle.** Add/remove tags, snooze, close, reopen. This is where SLA measurement becomes sensitive: closing from ESH stops the resolution clock, so it ships with a check that the engine's resolve time for an ESH-closed ticket matches an Intercom-closed one.

**Step 6 — Customer-facing replies.** Compose and send from the ESH ticket detail. Ships with a confirmation step, a per-ticket send log, and an explicit "sent as <teammate>" line. Piloted on one account for a week before opening to the full enterprise queue, regardless of how well the earlier steps went.

**Step 7 — Authority flip (decide later, not now).** Only once steps 1–6 have run a full month clean. At that point ESH owns state and pushes to Intercom, and the sync functions stop being allowed to overwrite ESH-owned fields. This is a separate planning exercise with its own reconciliation design — deliberately left unshaped here.

## Rough sequence

Assuming your usual scope-fenced batches, one to two per week:

| Weeks | Steps |
| --- | --- |
| 1 | Step 0 + Step 1 (spine, no UI) |
| 2 | Step 2 (severity), observe a full week |
| 3 | Step 3 (owner, product area) |
| 4 | Step 4 (notes) |
| 5–6 | Step 5 (tags, lifecycle) + SLA re-verification |
| 7–8 | Step 6 (replies), single-account pilot then full queue |
| 9+ | Step 7 decision, shaped separately |

## Technical notes

- `esh-write-action` is the single choke point. No page writes Intercom directly, and no page writes `intercom_tickets_v3` fields that Intercom owns. That gives one place for the kill switch, the audit row, the actor lookup, and rate limiting.
- Intercom calls go through the connector gateway pinned at `Intercom-Version: 2.13` to match the sync functions, so response shapes stay consistent with what `sync-v3-closed` already parses.
- Hub-only state (`dev_escalations.hub_state`, triage overrides, SLA excuses) is unaffected — it already lives outside the mirror and stays there.
- `sync-v3-open` skips finalized rows and never touches product area / classification / tags, so steps 2–3 do not race the 5-minute cron; `sync-v3-closed` remains the only writer at finalize, and since every ESH write went through Intercom first, its full GET returns the same values.
- Per project convention, each step gets its own `.lovable/project-knowledge.md` update via `sync-knowledge-pending`, a `changelog_entries` row, and a FlowDiagram node — per step, not batched at the end.
- Verification for every step: the positive case on a real ticket, the negative case with the kill switch off, and a re-read confirming Intercom and ESH agree.
