## Current behaviour

On the Stats page, the Slack "Success rate" card shows `resolved / received` (line 567 in `src/pages/Stats.tsx`):

```ts
const resolvedPct = total ? Math.round((resolved / total) * 100) : 0;
```

The problem: when a Slack thread is escalated to a human and later resolved in Intercom, the mapping's status flips to `resolved`. So escalations are silently counted as successes — that's why April reads 96% even with 49 handoffs out of 84.

## Change

Keep the existing "Success rate" card as-is, and **add a new card next to it called "Bot success rate"** that excludes escalations:

```
botResolved   = filtered where status = 'resolved' AND no intercom_conversation_id
botSuccessPct = botResolved / total
```

For April: (84 received − 49 escalated − any still-open) / 84.

### UI

- New card in the Slack stats grid (around line 1435 in `src/pages/Stats.tsx`), placed right after "Success rate".
- Icon: `Bot` from lucide-react, primary color.
- Label: "Bot success rate".
- Value: `stats.botSuccessPct%`.
- Update the grid from `lg:grid-cols-7` to `lg:grid-cols-8` (or wrap, since current visible count is 5 — fine as-is).

### Logic (in the `stats` useMemo, ~line 555)

Add:
```ts
const botResolved = filtered.filter(
  (m) => m.status === "resolved" && (!m.intercom_conversation_id || m.intercom_conversation_id === "")
).length;
const botSuccessPct = total ? Math.round((botResolved / total) * 100) : 0;
```

Return `botResolved` and `botSuccessPct` from the memo and render in the new card.

### Out of scope

- No changes to "Success rate", "Resolved", "Escalated to human", or any chart.
- No backfill or schema changes.
- Gmail / Manual / Intercom cards untouched.

### Follow-ups

- Update `.lovable/project-knowledge.md` with the new metric definition.
- Update the Flow page if the success-rate definition is referenced there (will check during implementation).
