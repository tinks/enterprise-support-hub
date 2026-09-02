## Recommended order, and why

**First: the three publish blockers.** They are the only items with an external gate attached. Do them in this internal order, because risk rises across them:

1. `open_data_read_fns` — six functions, all UI-invoked, no cron callers. Lowest risk, and it gets one of three findings off the board within the first stretch. Verify each from the UI after gating.
2. `gmail_oauth_hijack` — self-contained (two functions plus a nonce table and a definer RPC for the indicator). Needs a real OAuth round-trip to verify, plus the negative test: a replayed/absent `state` must be rejected before the token row is touched.
3. `open_mutation_fns` — highest risk, so last, and inventory before code. The cron/webhook functions carry no user JWT; gating them behind `requireEditor` fails silently and shows as stale data, not as an error. Each function gets classified (UI / cron / signed webhook) and verified against its real caller before the next one starts.

Then re-run the scan and publish.

**Second: performance items 4–5.** Small, self-contained, and they land while yesterday's items 1–3 are still fresh in `pg_stat_statements` — so the before/after read is a single check rather than two.

**Third: the four-way clock display pass.** This is the largest piece and the one with the most surface area (four screens plus a doc pass), so it wants an uninterrupted block rather than the tail of a security day. Nothing is broken while it waits — the columns are persisted and correct; the surfaces just still derive client-side.

**Not today:** the `eng_wait_source` fallback verification (do it opportunistically via synthetic replay when a real case appears, or fold it into the display pass if the escalations board work touches that code), and security batches 4 and 5, which stay deliberately unstarted.

## One correction to make

`roadmap.md` still lists multi-Linear escalations as an open decision. It shipped: `dev_escalation_links`, `resolveEngWaitWindows`, 596 rows backfilled clean, 10 union tests green. That section should move to done as part of whichever pass runs first.
