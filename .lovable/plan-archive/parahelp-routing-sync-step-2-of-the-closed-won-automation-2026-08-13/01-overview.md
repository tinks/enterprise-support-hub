# Parahelp routing sync — step 2 of the closed-won automation

Today the closed-won poller reads #closed-won daily at 04:00 UTC and inserts new rows into the customer registry. Step 2 makes sure each of those domains also gets routing set up in Parahelp, so mail to enterprise-support@lovable.dev from that domain lands in the Enterprise inbox.

There is no Parahelp connector in Lovable's catalog and no Parahelp API client in this project — the only trace of Parahelp today is the `lovable@parahelp.com` identity used by the SLA engine to recognise Sam. So this is built as a **routing queue with a pluggable push step**, not as a direct API integration we can finish blind.

## Design decision: the registry updater is never at risk

The poller stays exactly as it is. It writes the registry, and nothing else. A separate job owns Parahelp. If Parahelp is unreachable, misconfigured, or has no API at all, the queue simply accumulates rows and the poller keeps working untouched — which also means manual registry additions and backfills flow into the same queue, not just closed-won ones.
