## Recommendation: keep raw, but demote it

Keep it. Dropping raw entirely is the wrong call, for one concrete reason: raw wall-clock is the number Intercom itself reports (`statistics.time_to_last_close`). If the Hub is the only place that number does not exist, then the first time someone pulls Intercom reporting and gets 96.67h against the Hub's 2.25h, the Hub looks wrong rather than better. Keeping raw is what lets that gap be *explained* instead of *argued*.

The honest counter-argument, stated plainly: two numbers on a page is how metrics start lying again. People cite whichever one suits the story, and "resolution time" stops meaning one thing. That risk is real, and it is the thing this plan spends its rules on.

So the position is not "show both equally". It is:

- **Active is the metric.** One headline number per surface, everywhere, no exceptions.
- **Raw is reconciliation, not reporting.** Available on demand — secondary line, tooltip, drill-down, export column — never a headline, never a chart series next to active, never in the Slack summary.
- **One naming convention** so a number can never be read as the other: "Resolution (active)" and "Elapsed (raw)". Not "resolution time" for either, alone.

The failure mode this avoids is not confusion — it is a future reader silently comparing an August raw figure to a September active figure and reporting a 97% improvement that never happened.

## What changes

Four surfaces currently report raw wall clock as the headline: **Analytics v3**, **Trend report**, **Monthly lookback**, **Insights**. Each switches to the persisted `resolution_active_s` column (now backfilled on 590 of 592 finalized rows) as the headline, with raw demoted per the rules above.

Two surfaces already use the active clock and are not touched: **Resolution anatomy** and **SLA compliance**.
