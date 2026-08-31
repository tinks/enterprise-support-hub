# Dev escalations: SCA-3522 is missing, not unsearchable

## What I found

Search itself works — it already indexes the Linear reference. The ticket never reaches the board.

Intercom `215475673305527` (SCA-3522) has:

- `Ticket type` = **Issue**
- `Escalated Issue` = the full Linear URL for SCA-3522
- `lifecycle_status` = open

The board's population gate only admits `Ticket type` in (`Bug`, `Feature Request`). Everything else is dropped before search runs.

## How much is being hidden

Counts across the non-transferred v3 population, by ticket type, with the number carrying a Linear/Escalated Issue reference:

| Ticket type | Tickets | With a Linear link |
| --- | --- | --- |
| Question | 260 | 4 |
| Issue | 222 | 19 |
| Configuration | 45 | 1 |
| (none) | 41 | 1 |
| Feature Request | 23 | 10 |
| Bug | 16 | 11 |
| Incident | 5 | 4 |

So **29 escalations that already have a Linear link are invisible on the board** — only the 21 under Bug/Feature Request show up.

## Proposed change

Broaden the gate to: `Ticket type` in (Bug, Feature Request, Issue, Incident) **OR** the ticket carries any Linear/Escalated Issue reference (including a Hub override).

That keeps the current board intact, pulls in the 29 linked strays, and adds Issue/Incident as first-class escalation candidates for the "Needs Linear" queue. `transferred_out` and `not_enterprise` exclusions stay as they are.
