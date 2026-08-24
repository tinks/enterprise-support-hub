# Add an "Unassigned" queue to the Triage page

The Triage page becomes one destination for tickets that are not yet ready to be worked, with a mode switch instead of a second route.

Modes:

- **Needs severity** — today's queue, unchanged: no `Severity`, graded against the 30-minute business-hours target.
- **Unassigned** — open tickets with no Intercom assignee **or** no mapped Hub owner. Sorted oldest first, no color bands, no target.
- **Either missing** — union of the two, for a single glance at everything incomplete.

Why one page rather than a new route: both are triage-completeness gaps on the same population, they share the table, filters, detail sheet and the ticket-fields write panel, and each queue on its own is near-empty in steady state. Current numbers, open + reopened (49 tickets): 0 without severity, 1 without an owner.

## What "unassigned" means

Flagged when **either** signal is missing:

- `admin_assignee_id` is null or empty (nobody owns it in Intercom), or
- `owner` is null or empty (the assignee isn't in the Hub owner map).

The row shows which of the two is missing, so an unmapped-admin case reads differently from a genuinely unassigned ticket.

## Grading

The Unassigned mode has no target and no bands. Age is shown in business hours with wall-clock beside it, using the same anchor as the severity queue (Enterprise-Inbox assignment where present, else ticket creation), so numbers reconcile across surfaces. The band pill column is hidden in this mode.

## Action Center

A new **Unassigned tickets** signal counting open tickets missing assignee or owner, honouring the shared SLA exclusions (`isSlaExcluded`) so duplicates, FYI, prospect, non-enterprise and test rows don't raise it. It lists Intercom IDs like the other cards and links into `/triage` in Unassigned mode.
