

## Reorder stats cards and rename "Open cases" to "Open"

### Changes to `src/pages/Stats.tsx`

**1. Move "Open" card from resolution time section (lines 536-542) into the main stats grid (lines 466-516)**
- Place it right after "Cancelled" (after line 508)
- Rename label from "Open cases" to "Open"

**2. Move "Success rate" card (lines 495-501) to after the new "Open" card position**

**Resulting card order in main grid:**
Total → Resolved → Escalated to human → Cancelled → Open → Success rate → Avg / day

**3. Resolution time section** will keep only Median and Average resolution time (2 cards instead of 3), update grid to `grid-cols-2`.

### Summary
- 1 file changed, ~15 lines moved/reordered

