## Exclude `lovable.dev` from Top accounts (Gmail + Intercom)

### Change
In `src/pages/insights/ReportTab.tsx` `computeStats` (~line 540-545), when assigning a ticket to `emailMap`, skip it if the resolved email domain is `lovable.dev`. This applies to both Gmail (`from_email` domain) and Intercom (`contact_name` email domain) tickets, since both feed `customer_kind === "domain"`.

The Slack list is untouched. Ticket totals, source mix, daily volume, and other stats are untouched — this filter only affects the Top accounts widget.

### Subtitle
Update the Top accounts subtitle to mention that internal `lovable.dev` traffic is excluded from the Gmail + Intercom column.

### Memory + knowledge
- Save a project memory under `mem://logic/top-accounts-filter` recording: "Top accounts (Gmail + Intercom) excludes domain `lovable.dev` (internal employees) so external customers surface."
- Add a one-line entry under Core in `mem://index.md`.
- Update `.lovable/project-knowledge.md` "Monthly Report — Top accounts grouping" section with the same rule.

No DB or edge function changes.