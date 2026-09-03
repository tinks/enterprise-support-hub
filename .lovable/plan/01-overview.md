# Demo remix: skip the credentials, mock the connectors

That checklist is the remix asking you to reconnect the real world: live Gmail, Intercom, Slack, Linear, Notion, plus the cron secret. For a demo, do not connect any of them.

Every one of those connections would either pull real customer data back into the remix or let a demo click write to a live vendor. The demo should run entirely on seeded, fictional data with local mocks standing in for each integration.

Answer to the agent's checklist:

- Secrets 1-6 (Gmail, Intercom, Slack): leave unset. The code paths that need them get replaced by mocks.
- Secret 7 (ESH_CRON_SECRET): generate a fresh random value in the remix. It is self-issued, not a vendor credential, and it keeps the scheduled endpoints from being open.
- Connections 8-11 (Gmail, Linear, Notion, Slack): link none.
