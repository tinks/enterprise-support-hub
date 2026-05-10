## Problem

The "Escalated to human" stats on the Stats page show 0 for April 2026, but escalations definitely happened.

I checked the database for April 2026:
- `conversation_mappings` (Slack) has **55 conversations with an `intercom_conversation_id`** — i.e. they were handed off to a human in Intercom. None still carry status `escalated`/`escalated_pending` because once Sam/Joel/Kristina resolved them in Intercom, the status flipped to `resolved`.
- The only row in the entire DB still sitting at `status = 'escalated'` is one record from May 2026.

## Root cause

`src/pages/Stats.tsx` counts escalations purely from current status:

```ts
// line 560 (Overview card)
const escalated = filtered.filter(m => m.status === "escalated" || m.status === "escalated_pending").length;

// line 464 + 622 + 645 (Intercom card, daily volume, escalation-rate chart)
m.status === "escalated" || m.status === "escalated_pending"
```

`escalated` is a **transient** state — it gets overwritten the moment the human resolves the ticket. So the metric structurally cannot reflect history.

## Fix

Redefine "escalated" as **"was ever handed off to a human"**, detected by the presence of `intercom_conversation_id` on a Slack mapping. Apply this in four places in `src/pages/Stats.tsx`:

1. **Overview "Escalated to human" KPI** (line 560) — count Slack mappings where `intercom_conversation_id` is non-empty (regardless of current status), excluding `cancelled`/`test`.
2. **Status distribution pie** (lines 502–509 + 672) — bucket those rows under "Escalated" instead of "Resolved"/"Open" so the slices add up correctly.
3. **Daily volume chart** (lines 617–625) — `isEscalated` becomes "has intercom_conversation_id".
4. **Escalation-rate trend** (lines 642–658) — same predicate; denominator stays "completed conversations" (resolved + escalated).

The Intercom card (lines 460–488) measures Intercom-imported tickets directly and has no Slack handoff signal, so leave its `escalated`/`escalationPct` as-is but **rename the label** to "Currently escalated" so it's not confused with the Overview metric. (Or hide it — open question below.)

## Out of scope

- Backfilling a historical "was_escalated" boolean column. Using `intercom_conversation_id` is sufficient and already populated.
- Changing the live status machine.

## Open question

For the **Intercom card** (which counts tickets imported directly into Intercom, not Slack escalations), the `escalationPct` will basically always be ~0% with the current data. Should I:
- (a) Keep it and rename to "Currently escalated", or
- (b) Drop the escalation tile from that card entirely?

I'll default to (a) unless you say otherwise.
