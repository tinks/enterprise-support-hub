# Roll the gate back: escalations, not a backlog of unlinked tickets

Agreed — 217 rows in "Needs Linear" is noise, not a queue. Adding `Issue` as a first-class type dragged in 195 unlinked tickets that were never escalated to dev.

## The gate I'll ship

A ticket is on the board when **either**:

1. `Ticket type` is **Bug**, **Feature Request**, or **Incident** — the types that mean "escalated to dev", or
2. it already carries a **Linear reference** (Hub override, `Linear Issue`, or `Escalated Issue`) — whatever its type.

`Issue` stops being a qualifying type. `transferred_out` and `not_enterprise` exclusions unchanged.

## What that produces (verified by SQL, current population)

| Bucket | Rows |
| --- | --- |
| Bug / Feature Request / Incident | 44 |
| — of those, no Linear link → **Needs Linear** | 19 |
| Linked tickets of other types (Issue, Question, …) | 25 |
| **Board total** | **69** |

Compared to today's 263, and to the 39 before this morning's change.

## Why keep rule 2

A Linear link is proof the ticket *was* escalated to dev, regardless of how it was typed in Intercom. That's exactly SCA-3522 (typed `Issue`) and CLO-1225 (typed `Question`) — the two tickets you couldn't find. Those 25 rows all land in **Linked escalations**; none of them can ever appear in "Needs Linear", because being linked is what admits them.
