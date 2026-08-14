---
name: ESH write rollout (working tickets in the Hub)
description: Step-by-step rollout turning the ESH from a reporting mirror into a place tickets are worked — write-through via esh-write-action, one action per step, each gated on a negative test
type: feature
---

# ESH write rollout

Turning the Hub from a read-only reporting mirror into the place enterprise tickets
are worked. Ordered by blast radius, not effort. Each step adds exactly one write
action, on one surface, behind the kill switch, proven on a real ticket including
a negative test before the next step starts.

## Two invariants (do not break these at any step)

1. **Write-through, not local authority.** `intercom_tickets_v3` is still a mirror —
   `sync-v3-closed` does a full GET at finalize and overwrites Intercom-owned fields.
   So every write is: call Intercom → wait for 2xx → re-read the conversation →
   only then update the local row. If Intercom rejects, the local row does not
   change and the UI says so. No optimistic updates on Intercom-owned columns.
2. **Attribution to the human.** Every Hub write lands in Intercom as the acting
   teammate's `intercom_admin_id`, never a generic bot admin. Otherwise the SLA
   actor classification starts measuring the Hub instead of the team.

## Choke point

`supabase/functions/esh-write-action/index.ts` is the only thing allowed to call
Intercom or write Intercom-owned columns. It carries the kill switch
(`settings.esh_write_enabled`), the per-action allowlist
(`settings.esh_write_allowed_actions`), teammate resolution, and the append-only
audit table `public.esh_ticket_actions` (every attempt: succeeded / blocked / failed).
Intercom calls pinned at `Intercom-Version: 2.13` to match the sync functions.

New actions are added by name to `KNOWN_ACTIONS` + a handler + the allowlist.
Nothing else in the app gets to write.

## Steps

| Step | Scope | Status |
| --- | --- | --- |
| 0 | Actor mapping — `intercom_admin_id` on every active support teammate | done |
| 1 | Write spine — `esh-write-action`, audit table, kill switch, allowlist | done, verified (8 attempts, all outcomes) |
| 2 | Severity from the Triage queue | built, awaiting live verification |
| 3 | Owner + product area | next |
| 4 | Internal notes | |
| 5 | Tags + lifecycle (snooze / close / reopen) | |
| 6 | Customer-facing replies | |
| 7 | Authority flip — shaped separately, not now | |

### Step 2 — severity (built)
`SeverityWriteControl` in the Triage detail sheet calls `esh-write-action` with
`set_severity`. Refusals render inline in the sheet — never a silent no-op. Local
row updates only after the function confirms Intercom accepted, which drops the
ticket out of the untriaged list immediately instead of waiting on the 5-min sync.
Smallest possible write: one field, one enum, on tickets that by definition have
no value yet, so there is nothing to overwrite.

### Step 3 — owner + product area
Same path, two fields, Triage plus the Inbox v3 detail sheet. First conflict case
(field may already hold a value), so the write carries an "expected current value"
check and refuses if Intercom moved underneath you.

### Step 4 — internal notes
First write producing an artifact other people see in Intercom. Not customer-facing,
but exercises the full attribution path replies depend on.

### Step 5 — tags + lifecycle
Where SLA measurement becomes sensitive: closing from the Hub stops the resolution
clock. Ships with a check that the engine's resolve time for a Hub-closed ticket
matches an Intercom-closed one.

### Step 6 — customer-facing replies
Confirmation step, per-ticket send log, explicit "sent as <teammate>" line.
Piloted on one account for a week before the full enterprise queue, regardless of
how clean steps 2–5 went.

### Step 7 — authority flip
Only after steps 1–6 run a full reporting month clean. Hub owns state and pushes
to Intercom; sync functions stop being allowed to overwrite Hub-owned fields.
Separate planning exercise with its own reconciliation design.

## Per-step definition of done

- Positive case on a real ticket.
- Negative case with the kill switch off (refusal visible in the UI, audit row written).
- Re-read confirming Intercom and the Hub agree.
- `.lovable/project-knowledge.md` update via `sync-knowledge-pending`, a
  `changelog_entries` row, and a FlowDiagram node — per step, not batched at the end.

## Test population

Test-account tickets (`v3_customer_accounts.is_test`) are excluded from the SLA
population, so they're safe for exercising mechanics. They cannot prove
attribution (never enter the SLA population) or sync interaction (never reach
finalize) — each step therefore also needs one real ticket watched through close.
Test tickets do fire the new-ticket Slack alert; deliberately not suppressed.
