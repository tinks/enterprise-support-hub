

## Fix missing statuses in Open count + add escalation metrics

### The problem

**Missing 3 cases:** The "Open" card counts only `active + awaiting_context + escalated`, but your database has conversations in `processing`, `active_pending`, and `escalated_pending` statuses that aren't counted anywhere. Currently there are 3 `escalated_pending` and 1 `processing` conversation missing from the totals.

**Database status breakdown (all time):** resolved: 127, active: 17, escalated: 16, escalated_pending: 3, cancelled: 1, processing: 1

### Changes to `src/pages/Stats.tsx`

**1. Count ALL open statuses**

Add `active_pending`, `escalated_pending`, and `processing` to the stats memo so every conversation is accounted for:

```
Open = active + awaiting_context + escalated + active_pending + escalated_pending + processing
```

This ensures Total = Open + Resolved + Cancelled always holds.

**2. Add "Escalated to human" metric card**

Add a card showing the total number of conversations that reached an escalated state (`escalated` + `escalated_pending`). This is an informational/subset metric — it doesn't change the Total math.

Place it after the "Open" card. Adjust grid to `lg:grid-cols-7`.

**3. Update pie chart and daily outcomes**

- Pie chart: keep three primary slices (Resolved, Open, Cancelled) but add Escalated as a visual sub-slice of Open
- Daily outcomes: include escalated as a separate stacked bar for visibility

### Summary
- 1 file changed (`Stats.tsx`)
- Fix Open to include all non-resolved/non-cancelled statuses
- Add escalated count as an informational metric
- Math will validate: Total = Open + Resolved + Cancelled

