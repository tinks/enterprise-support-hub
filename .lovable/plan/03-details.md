## The fix

Make the Action Center's SLA signals honor the same exclusion rules as the SLA population, so the card and the workbench can never disagree.

### Approach

Extract the exclusion predicate that today lives inside `classifySlaBatchRow` (`src/hooks/useSlaBatch.ts`) into a small shared helper — `isSlaExcluded(row)` in `src/lib/slaExclusions.ts` — covering:

- `rsa_override === false`
- `rsa_override` unset and tagged `enterprise-fyi` or `enterprise-duplicate`
- tagged `merged_ticket`
- `customer_resolution_method` of `not_enterprise`, `prospect_personal`, or `enterprise_prospect`
- test accounts (`v3_customer_accounts.is_test`)

`classifySlaBatchRow` then calls the helper, so the workbench behavior is unchanged by construction.

### Action center changes (`src/lib/actionSignals.ts`)

- Widen the `first_response_risk` query to also select `tags`, `rsa_override`, `customer_resolution_method`, and `customer_key`, and load the test-account key set once.
- Skip any ticket where `isSlaExcluded` is true.
- Apply the same skip to the other SLA-family signals that read the ticket mirror directly, so the whole family is consistent.
- Add a line to the card's `meaning` text stating that tickets excluded from the SLA population (fyi, duplicate, merged, prospect, non-enterprise, test) are not counted — so a future zero is legible rather than mysterious.

### Verification

- Re-run the signal loader against the live mirror and confirm ticket `215475518887389` no longer appears in the card's item list.
- Confirm the workbench in-scope, excluded, and violations counts are byte-identical before and after the refactor.
- Confirm at least one genuinely in-scope, past-target ticket still counts — a filter that zeroes everything is a regression, not a fix, and I'll report the count explicitly.

### Paperwork

Per the standing convention: a `changelog_entries` row, a pending `.lovable/project-knowledge.md` update via `sync-knowledge-pending`, and a FlowDiagram note that the Action Center SLA signals share the SLA exclusion predicate.
