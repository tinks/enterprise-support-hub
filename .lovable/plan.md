

## Fix Flow Diagram Layout — Increase Spacing

### Problem
Nodes have grown larger with additional text and details but the default positions still use tight spacing (`ROW_H = 260`), causing overlaps.

### Fix — `src/pages/FlowDiagram.tsx`

**1. Increase spacing constants**
- `ROW_H`: 260 → 380 (more vertical room for tall nodes)
- `COL_W`: 360 → 420 (more horizontal room for the 3-column layout at row 2)

**2. Adjust specific node positions**
The multipliers on individual nodes also need tuning — especially:
- Nodes 3a/3b/3c (row 2): widen horizontal spread to prevent overlap
- Node 4 (Intercom ticket, `wide: true`): needs extra vertical gap below the 3-column row
- Node 5 (AI responds, `wide: true`): push down further
- Nodes 6a/6b/6c (row 5): widen spread and increase vertical gap from node 5
- Nodes 6bi/6bii (row 6.5): adjust accordingly
- Node 7 (closed): push to bottom

**3. Clear saved positions**
Since the DB stores dragged positions that override defaults, we should also reset the `flow_node_positions` table so the new defaults take effect. This will be a one-time migration that truncates the table.

### Summary
- One file change: `src/pages/FlowDiagram.tsx` (spacing constants + position coordinates)
- One migration: truncate `flow_node_positions` to reset saved positions

