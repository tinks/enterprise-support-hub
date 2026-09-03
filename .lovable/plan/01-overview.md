# Demo isolation checklist

A verification pass to run **in the remix**, not here. Goal: prove the demo cannot read or write the real Enterprise Support Hub — neither its database nor the vendor systems behind it — and that it stays that way after a reset.

Two boundaries matter, and they fail differently:

- **Data boundary** — the remix must use its own backend project ref, with only generated rows in it. Already reported as verified; the checklist re-proves it with commands rather than assertion.
- **Outbound boundary** — no edge function may reach Intercom, Slack, or Gmail. Secrets are now deleted, which makes reach impossible, but a function that *throws* on a missing secret is a broken demo button. Each affected path must degrade to a mock instead.

Confirmed on this side: deleting the six vendor secrets in the remix did not touch this project — GMAIL_CLIENT_ID/SECRET, INTERCOM_API_TOKEN/WEBHOOK_SECRET and SLACK_BOT_TOKEN/SIGNING_SECRET are all still present here, along with the connector-managed keys.
