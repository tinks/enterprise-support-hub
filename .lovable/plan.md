

## Fix stats math: Total = Open + Resolved + Cancelled

### Problem
"Escalated to human" is counted separately, so Total (29) ≠ Open (2) + Resolved (21) + Cancelled (0). The correct model is: escalated conversations are a subset of **Open** (they're not resolved, not cancelled — they're still open, just handed to a human).

### Changes to `src/pages/Stats.tsx`

**1. Merge escalated into Open count (line 505)**
- Change `stats.active + stats.awaiting` → `stats.active + stats.awaiting + stats.escalated`
- This makes Open = active + awaiting_context + escalated

**2. Remove the standalone "Escalated to human" card (lines 488-493)**
- Delete that card from the grid

**3. Update grid columns**
- Change `lg:grid-cols-7` → `lg:grid-cols-6` (one fewer card)

**4. Update success rate denominator (line 158)**
- Change `feedbackTotal = resolved + escalated` → `feedbackTotal = total - cancelled` or keep as-is depending on intent. Current formula is fine if success rate = resolved / (resolved + escalated).

**5. Remove "Escalated to human" from pie chart data** and fold it into an "Open" slice, or keep it as a breakdown sub-category. Given the user's model (Total = Open + Resolved + Cancelled), the pie should show three slices: Open, Resolved, Cancelled.

**6. Update daily outcomes chart** — merge escalated into open in the stacked bar/area data.

**Resulting card order:** Total → Resolved → Cancelled → Open → Success rate → Avg / day

**Validation:** Total (29) = Resolved (21) + Open (2+6=8) + Cancelled (0) = 29 ✓

### Summary
- 1 file changed (`Stats.tsx`)
- Remove escalated card, merge count into Open
- Update pie chart and daily outcomes to use 3 categories
- Update grid layout

