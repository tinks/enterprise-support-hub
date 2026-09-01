## What the page shows

**Header** — month picker, ticket volume vs prior month, finalized count, still-open count, categorisation coverage of the finalized population.

**Theme trends** — product area and ticket type, each as a table with this month, prior month, delta, and share of month. Sortable headers. Rows click through to Inbox v3 filtered to that month and area, so every number in the narrative is inspectable.

**Spikes** — the movers computed rather than eyeballed: areas whose share moved more than a set threshold vs the prior month, and areas new this month. SSO/SCIM/SAML at 28 is the current leader; the page will say whether that is a step change or the normal level.

**Customer cuts** — tickets per account (top 15), plan tier split, and a concentration line ("top 5 accounts drove N% of the month"). Repeat-contact accounts flagged: accounts with tickets in both months and growing. No size or stage claims.

**Quality** — median and P90 resolution on the active clock (closed time removed, per the resolution-anatomy engine), reopen rate, CSAT with internal raters and overrides excluded via the existing `csat.ts` logic, and SLA/triage attainment from the existing engine.

**Shipped and process** — August `changelog_entries` rows grouped by area, plus dev escalations opened/closed in the month. These are pulled, not typed.

**Commentary** — a per-section notes field you write, stored in a small table so the narrative persists month to month and exports with the numbers.

**Copy as narrative** — one button that emits the whole month as a formatted write-up (numbers plus your commentary), which is what gets sent to Mgmt.

## The August document

Once the page is live I generate `/mnt/documents/august-2026-support-lookback.md` from it, structured for Mgmt: headline, theme trends, customer picture, spikes and what caused them, quality, shipped and process improvements, and what to watch in September. Numbers come straight out of the page; the commentary is yours to edit before sending.

## Technical detail

- New page `src/pages/MonthlyLookback.tsx`, route `/monthly-lookback`, added to the Reports group in `AppLayout.tsx`.
- One paged read over `intercom_tickets_v3` covering the selected month and the prior month, plus reads of `changelog_entries`, `dev_escalations`, `csat_overrides`, `v3_customer_accounts`.
- Reuses the shared modules rather than re-deriving: `src/lib/slaExclusions.ts` for population, `src/lib/csat.ts` for CSAT integrity, `src/lib/resolutionAnatomy.ts` for the active clock, `useTableSort` for headers. Anything the Trend report already computes is imported, not copied, so the two pages cannot drift.
- Population rule: reporting cuts use finalized tickets; volume uses all tickets created in the month; `transferred_out` and RSA-false tags are excluded from quality metrics.
- New table `public.esh_lookback_notes` (`month`, `section_key`, `note_text`, `updated_by`, `updated_at`), RLS read for authenticated and write gated by `can_edit()`, GRANTs in the same migration.
- Small worklist card: the 8 finalized August tickets missing product area and 10 missing ticket type, linked to Inbox v3 so the closure-rule leak gets cleaned rather than caveated.
- Doc pass afterwards: `.lovable/project-knowledge.md` staged through `sync-knowledge-pending`, a `changelog_entries` row, and a FlowDiagram node.

Not verified yet: whether the 8 finalized tickets missing product area bypassed the closure rule or were closed through a path that skips it. I will name the cause from those 8 rows before the report asserts anything about the rule.
