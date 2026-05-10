## Exclude "Personal email" bucket from Top accounts (Gmail + Intercom)

### Change
In `src/pages/insights/ReportTab.tsx` `computeStats`, extend the existing email-domain skip filter to also skip the personal-email aggregate (`customer_key === "domain:_personal"`). The bucket still exists in the underlying data — we just don't show it in the Top accounts widget because it lumps unrelated consumer senders together.

### Subtitle
Update the Top accounts subtitle to mention that both internal `lovable.dev` and the consumer "Personal email" bucket are excluded.

### Memory + knowledge
- Update `mem://logic/top-accounts-filter` to add the Personal email exclusion.
- Update `.lovable/project-knowledge.md` "Monthly Report — Top accounts grouping" section to match.

No DB or other UI changes. Other widgets (Source mix, totals, CSAT, etc.) keep showing personal-email tickets.