# Dev escalations redesign

The page's job, restated: a Support Engineer opens it to answer two questions — *which of my bug/feature tickets are missing a Linear issue?* and *what's the status of the ones that are linked?* Everything else is secondary.

## What changes

**1. Two queues instead of one mixed table.**

- **Needs a Linear issue** — bug/feature tickets with no resolvable Linear reference. This is the safety net, so it goes first, with its count in the section header. Oldest first.
- **Linked escalations** — everything with a Linear key, grouped under the same table template, sorted oldest first within active hub states.

A single segmented control switches between the two (plus "All"), so only one table is on screen at a time.

**2. Less noise.**

- Default columns drop to: Intercom ID · Subject · Customer · Type · Linear · Hub state · Age. Contact, Owner, Intercom state and Note move into a row detail sheet (clicking a row opens it, matching Triage and Inbox v3).
- The three-line explanatory info banner collapses into a single "How this works" popover behind an info icon.
- The five hub-state count pills collapse to counts in the two section headers plus a compact state filter.
- Inline Linear-link editing and note editing move out of the table cells into the detail sheet, so no table cell can flip into an input.

**3. Notes become real conversation notes.**

Today `dev_escalations.note` is a single text field readable only by this page — verified: nothing else in the app reads it. That is why a note written here disappears when you find the ticket anywhere else.

Notes move to `conversation_notes` (the same table the conversation detail page already uses), keyed by the v3 ticket's uuid with `conversation_source = 'intercom_v3'`. That makes them a threaded, authored, timestamped list instead of one overwritable line, and makes them visible wherever v3 notes are shown. Existing `dev_escalations.note` values are copied over once; the column stays in place as a rollback path.

## What does not change

Linear is still read-only from the Hub. Hub state, the daily `sync-linear-escalations` mirror, and the qualification rules (Ticket type Bug/Feature Request, excluding transferred-out and non-enterprise) all stay exactly as they are.
