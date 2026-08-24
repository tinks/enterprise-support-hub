## What you found is real

Ticket `215475518887389` is `open`, severity 4, tagged `enterprise-duplicate`, with no manual RSA override (verified in the database just now).

The two surfaces disagree because they apply different population rules:

- SLA workbench runs every ticket through `classifySlaBatchRow`, which excludes a ticket when `rsa_override` is unset and it carries `enterprise-fyi` or `enterprise-duplicate` (plus `merged_ticket`, `not_enterprise`, and the two prospect gates, and test accounts). This ticket lands in the **excluded** bucket, so it never reaches the violations table.
- The Action Center `first_response_risk` signal queries `intercom_tickets_v3` directly and filters on only three things: lifecycle open, a parsed severity, and no `sla_breach_overrides` row for `first_response`. It knows nothing about tags, RSA, resolution method, or test accounts.

So yes — the label removes it from the workbench, but not from the Action Center. This is not specific to `enterprise-duplicate`: every exclusion the SLA population honors is currently invisible to the Action Center card, so the card can over-count.
