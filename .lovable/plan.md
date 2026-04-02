

## Update FlowDiagram with status label changes

### What it does
Completes the last step of the already-implemented plan by updating `src/pages/FlowDiagram.tsx` to document:
1. The `awaiting_context` display label rename to "Awaiting customer"
2. The new `awaiting_support` status

### Changes

**`src/pages/FlowDiagram.tsx`**
- Update any status-related nodes/documentation to include `awaiting_support` as a valid status
- Document that `awaiting_context` displays as "Awaiting customer" in the UI

### Files to edit
- `src/pages/FlowDiagram.tsx`

