# Make the Intercom webhook ack fast, work in the background

## What monitoring saw

`POST /functions/v1/intercom-webhook` returned 503 x16 (2026-08-25 08:35–08:37), 504 x2 (21:14, 22:22), 520 x1 (00:08). When that happens Intercom retries or drops the delivery, so a ticket, assignment, or status change can silently never land in the Hub or Slack.

## What the code shows

`supabase/functions/intercom-webhook/index.ts` is 1760 lines and does everything inside the request handler before responding: signature verify, bot-identity check, several Supabase reads/writes, Intercom conversation fetches, Gmail-thread matching (email tier + subject tier), Slack posts, guard alerts. There are ~40 return points, all after that work. A slow Intercom or Slack call therefore holds the HTTP response open until the platform kills it (504), and bursts of concurrent deliveries push the instance into boot/CPU limits (503).

The failure class matches the code shape, but the exact slow call is not proven from logs alone — step 1 below measures it before anything is restructured.

## Constraint that shapes the design

This webhook is not idempotent by accident — it is idempotent by design in places (row-level `FOR UPDATE` claims, dedup guards, cross-thread link guard) and *not* in others. Moving all of it behind an early 200 removes Intercom's retry as a safety net, so the change must be staged, not done in one sweep.
