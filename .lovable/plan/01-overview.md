# Workaround provided override for dev escalations

Ticket 215475214997973 sits behind CLO-1074 ("Allow switching DB region after app creation"),
which is in Backlog with no assignee. Because nobody has picked it up, the queue treats it as
pre-ack and chases it every 24 hours — forever. But dev already handed over a manual procedure,
so there is nothing left to chase.

The fix: a Hub-only **Workaround provided** override. Marking it takes the ticket out of the
dev-wait bucket and stops the chase clock, while keeping the Linear issue and its live state
visible on the card. Nothing is written to Intercom or Linear.

To answer the concern directly: the escalation card is rendered from the joined `dev_escalations`
row, not from the bucket. Leaving the bucket does not remove the card — the key, title, state and
assignee stay exactly where they are, just with a "Workaround provided" pill instead of a chase
prompt.
