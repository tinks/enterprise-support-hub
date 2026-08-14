## Goal, as I understand it

Turn the ESH from a read-only reporting mirror into the place support actually works enterprise tickets — eventually replacing the Intercom inbox for this queue: replies, notes, assignment, tags, severity, lifecycle. The long-term end state is ESH as the authoritative system, with Intercom demoted to a transport channel.

Getting there safely means the opposite of a big cutover. Each step adds exactly one write action, on one surface, behind a kill switch, and is proven against a real ticket — including a negative test — before the next step starts. Nothing in the reporting mirror's accuracy may regress along the way.

## The two hard problems

**1. Write-through vs. authority.** Today `intercom_tickets_v3` is a mirror: `sync-v3-closed` does a full GET at finalize and overwrites product area, classification, tags, and CSAT from Intercom. If ESH writes those fields locally without pushing them to Intercom first, the next sync silently reverts them — a quiet lie, exactly the failure mode this project exists to prevent.

So every step until authority flips is **write-through**: ESH calls Intercom, waits for the 2xx, re-reads the conversation, and only then updates the local row. If Intercom rejects, the ESH row does not change and the UI says so. "ESH becomes authoritative" is the destination, not step one — the flip only happens after the write-through path has run clean for a full reporting month.

**2. Who is acting.** The SLA engine classifies actors (`customer`, `human_admin`, `sam_ai`, `operator_bot`, `shared_inbox`). Every ESH-originated write must land in Intercom attributed to the *teammate* who did it, not a generic bot admin — otherwise the engine starts measuring the Hub instead of the humans, and first-response and cadence numbers become fiction. This requires mapping each ESH user to an Intercom admin ID before any customer-facing write ships.

## Sequencing principle

Ordered by blast radius, not by effort:

```text
internal-only fields  →  Intercom-owned metadata  →  internal notes
      →  lifecycle (snooze/close)  →  customer-facing replies
```

The first three are recoverable by hand in seconds. A wrong customer reply is not recoverable at all, so it ships last, after the audit trail, the actor mapping, and the kill switch have all been exercised in anger.
