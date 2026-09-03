# Standardizing reporting metrics

The problem, stated plainly: two pages can both say "resolution time" and disagree by 34x, because one reads the raw wall clock (`time_to_resolve_s`) and the other reads the active clock (`resolution_active_s`). Population choice barely moves the number (2.6h vs 2.7h on Aug 2026); the metric *definition* is what moves it. That is a trust problem, not a data problem.

Your instinct — base everything on the SLA framework — is right about rigor but wrong about reach: `useSlaBatch` needs full conversation payloads per ticket, so it cannot run over a whole month in the browser. So the standard is layered, and a shared library, not a page, is canonical.

## Decisions already made (2026-09-03)

- Scope: **layered standard**
- Reporting focus: **time to triage** (when Severity was first set) and **time to human first reply** — agent/bot reply is not the headline number
- Canonical: **a shared library**, no canonical page

## The three layers

- **Population** — one definition of "counts as an Enterprise ticket", owned by the SLA exclusion rules (`slaExclusions.ts` + test tickets + `transferred_out` + plan scope). Every report filters through it.
- **Responsiveness** — time to triage and time to human first reply, both computed from the conversation timeline by the SLA engine and **persisted** onto `intercom_tickets_v3` so month-scale reports can read them cheaply.
- **Resolution** — the persisted four-way clock (active / customer wait / engineering wait / closed). Raw `time_to_resolve_s` stops being displayed anywhere as "resolution time"; it survives only as a labelled "wall clock" secondary.

Volume stays deliberately broad and is labelled as such — it answers "how much came in", not "how much did we owe an SLA on".
