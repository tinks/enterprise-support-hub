

## Reorder flow nodes: 6a (left) → 6b (center) → 6c (right)

Currently the order is 6a (left), 6c (center), 6b (right). The user wants: **6a (left), 6b (center), 6c (right)** — placing 6c on the right side creates a natural visual loop back up to Node 5.

### Changes in `src/pages/FlowDiagram.tsx`

**Node positions (lines 179, 202, 219):**
- 6a stays at `x: COL_W - COL_W * 0.7` (left) — no change
- 6b moves to `x: COL_W` (center)
- 6c moves to `x: COL_W + COL_W * 0.7` (right)

**Edge labels (lines 318-321):**
- `e5-6a` (Resolved) — left branch, no change
- `e5-6b` (Escalate) — center branch
- `e5-6c` (Reply in thread) — right branch
- `e6c-5` (Sam responds again) — loops from right back up to center, creating a clean visual loop

**Downstream edges from 6b (lines 322-323):**
- Adjust `6bi` and `6bii` positions to flow from the center column instead of the right

**Node 6bi** position: shift left to align under 6b (center area)
**Node 6bii** position: shift to right of center

