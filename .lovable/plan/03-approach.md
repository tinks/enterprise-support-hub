## What to build

### 1. Resolution anatomy (the answer to "what is causing that")

Every finalized ticket already carries its full Intercom conversation in `raw_payload`, and the SLA engine already knows how to read it: `extractTimeline()` turns it into ordered parts and `classifyActor()` labels each part as customer, human admin, Sam AI, operator bot, system, or shared relay inbox.

Walk that timeline and attribute every gap between consecutive messages to whoever owed the next move:

- **Our clock** — gap opened by a customer message, closed by a human admin reply.
- **Their clock** — gap opened by our reply, closed by a customer message.
- **Silent drift** — the stretch after the last message of any kind, up to the close.

Also record, per ticket: reply count, longest single gap and who owned it, whether it was reopened, and whether the close followed a customer message or came from us with no answer (the "customer never confirmed, we closed it out" case you suspected).

These are wall-clock first, with a business-hours variant computed via the existing Berlin `businessHoursBetween()` so a Friday-evening handoff does not read as two lost days.

### 2. Long-runners view

A page listing every ticket over a threshold you set (default 7 days), newest first, showing the three-way split as a single stacked bar per row plus the numbers behind it. Filters for month, product area, classification, owner, customer, and reopened. Sortable headers, standard convention.

Click a row and you get its timeline: each message, actor, and the gap that followed, so the reason is readable in about ten seconds rather than inferred.

### 3. Cohort rollup

The same split aggregated, so the diagnosis stops being anecdotal:

- By month — is our clock growing, their clock growing, or drift growing? That single chart answers whether this is a staffing problem, a customer-responsiveness problem, or a hygiene problem.
- By product area, classification, owner, and customer, restricted to long runners.

From the data already queried, the long-runner tail concentrates in Account access and permissions, SSO/SCIM/SAML, and Billing/credits/plans (SSO carries the worst averages, 16.6d on Issues and 20.8d on Questions). The rollup will confirm whether those are slow because we are slow on them or because they need customer-side action.

### 4. One measurement correction to decide

`time_to_resolve_s` is Intercom's `time_to_last_close`. A reopen three weeks later re-clocks the entire ticket, and 29% of long tickets were reopened. Alongside the existing number I will compute **time to first close**, and show both. If they diverge materially, the trend report's average is partly measuring reopen behaviour rather than resolution speed. I will not change the existing metric — just expose the second one so you can see the gap before deciding.

## Where it lives

**Reports → Resolution anatomy**, at `/resolution-anatomy`. Read-only. No writes to ticket data, no changes to the SLA engine's existing outputs, no change to Analytics v3 or Trend report numbers.

## Scope note

This is a diagnosis surface, not a fix. It should end with you able to say "the extra day per month is X", where X is one of: we are slower to reply, customers are slower to respond, tickets sit idle before close, or reopens are inflating the clock. Right now the data supports none of those over the others.
