# Publish the customer registry to a Notion page for Parahelp

Parahelp can't take a domain over an API — their enterprise list lives in the agent's memory file and every edit goes through their approval queue. What they *can* do is read a Notion page and draft the additions themselves. So the Hub's job is narrow and clear: keep one Notion page that is an exact, machine-readable mirror of the registry's domains, and keep it boring.

The registry today: 237 accounts, 492 domains, statuses `active` (235), `prospect` (1), `inactive` (1), plus one `is_test` account.

## What ships

A **Notion mirror** of the registry — one page, rewritten by an edge function on a daily cron and on demand from a "Sync to Notion" button on the existing Admin → Customers → Parahelp routing tab. The page holds a table with a Domain column (Parahelp's stated preference), one row per domain.

Two properties this design insists on:

- **Idempotent.** The function hashes the rendered domain set and skips the write when nothing changed. If Parahelp uses their "when the page changes" trigger, they only get woken when a domain actually appeared or left — not once a day forever.
- **Never invents.** Only domains that are in the registry go on the page. Removals show up as removals; the page is a full rewrite, not an append log, so it can't drift from the source of truth.

The existing `parahelp_routing_sync` queue stays exactly as it is. Its dormant API push leg is now known to be dead-on-arrival (there is no such endpoint), so it becomes purely the manual working list, and the Notion page becomes the real hand-off.
