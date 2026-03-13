

## Enable drag-and-drop for flow diagram nodes

### Problem
`nodesDraggable={false}` prevents any repositioning. The layout is rigid and looks cramped.

### Changes in `src/pages/FlowDiagram.tsx`

1. **Enable dragging**: Remove `nodesDraggable={false}` (line 379) — React Flow defaults to `true`
2. **Use controlled nodes**: Convert from static `nodes` to state-managed nodes using `useNodesState` from `@xyflow/react`, so drag positions persist during the session
3. **Keep `nodesConnectable={false}`** — users shouldn't create new edges
4. **Update Controls**: Remove `showInteractive={false}` so the lock/unlock toggle is available

```typescript
import { useNodesState } from "@xyflow/react";

// Replace:
const nodes = useMemo(() => buildNodes(messages, handleSave), [messages, handleSave]);

// With:
const initialNodes = useMemo(() => buildNodes(messages, handleSave), [messages, handleSave]);
const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);

// Sync when messages change:
useEffect(() => { setNodes(buildNodes(messages, handleSave)); }, [messages, handleSave]);

// In ReactFlow:
<ReactFlow
  nodes={nodes}
  onNodesChange={onNodesChange}
  // remove nodesDraggable={false}
  ...
/>
```

