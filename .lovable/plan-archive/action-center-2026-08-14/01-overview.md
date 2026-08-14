# Action Center

One place that answers "does the Hub need me right now?" — and one badge in the sidebar that answers it without opening anything.

## Recommendation on surface

Option B: a dedicated `/action-center` page plus a single aggregate count badge on the sidebar rail.

Why not per-nav badges (option A or C): the signals do not map one-to-one onto nav rows. Pending Parahelp domains, an unpublished Notion registry, a knowledge doc awaiting approval and an integration failing all live on pages you would not think to open, and three of them sit under the same Admin group. A per-row badge would either miss them or stack four badges on one row. One number on the rail plus one page that names each signal, its count, its age and where to go is honest about what is waiting and costs one nav entry.

## Signals in v1

All four families you selected, as independent cards, alerting on any count above zero:

| Family | Signals |
| --- | --- |
| Queues | Unattributed customers, untriaged tickets (no severity), open dev escalations not yet customer-notified |
| SLA risk | Open tickets past first-response, triage or cadence target in the current window |
| Pipeline health | Integration health failures, stale v3 sync, pending Parahelp routing domains, unpublished registry changes |
| Review items | Pending knowledge-doc approvals, channel→account proposals awaiting a decision |

Every count is read live from the same source the destination page uses — no new tables, no cached counters that can drift from the page they link to.

## Live counts right now

Confirmed against the database while writing this: untriaged 11, everything else 0 (unattributed queue is empty since the `enterprise-not-enterprise` tag landed). So on first load the Action Center shows one live card and eleven quiet ones — a useful shakedown of the "any count > 0" rule.
