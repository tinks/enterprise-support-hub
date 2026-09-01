# August 2026 monthly lookback

Mgmt wants a narrative month review: theme trends, customer cuts, spikes, and what shipped. Build it as a repeatable page first (`/monthly-lookback`), then export August out of it as the document to send.

## First: the categorisation gap is not what it looked like

You were right to push back. I checked the 242 August tickets:

- 39 of the 55 missing product areas are tickets that are **still open** — never closed, so the closure rule never fired.
- 8 more are **transferred out** of the Enterprise inbox.
- Only **8 of 188 finalized-closed tickets (4.3%)** are genuinely missing product area, and **10 (5.3%)** missing ticket type.

So the reporting population is ~95% categorised, not 77%. The report will be scoped to the finalized population and will name the 8 leakers as a small worklist rather than caveat the whole month.

## What August actually holds (verified counts)

- 242 tickets created, vs 193 in July — **+25% month over month**
- 239 enterprise plan, 3 SSE
- Top areas: SSO/SCIM/SAML 28, Account access and permissions 22, Main product 22, Billing/credits/plans 20, Other 18
- Ticket types: Question 78, Issue 69, Configuration 21, Feature request 9, Bug 5, Incident 3
- 221 tickets attributed to a named account; 17 not-enterprise, 3 unmapped prospects

## On customer size and stage

`v3_customer_accounts.tier` is empty for all 253 accounts and there is no stage field, so the report will not claim anything about size or stage. It will cut by account, plan tier, and concentration (how much of the month a handful of accounts drove), and state plainly that size/stage is not tracked yet.
