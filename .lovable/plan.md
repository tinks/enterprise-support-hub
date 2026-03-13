

## Make recursive loops visible with arrows and labels

### Current state
- The AI loop (6c → 5) already has a back-edge but no arrowhead and a subtle label
- The escalated path (6bi, 6bii) goes straight to node 7 with no loop edges between them
- React Flow edges don't show arrowheads by default — need `markerEnd` property

### Changes to `src/pages/FlowDiagram.tsx`

**1. Add arrowhead markers to all edges** via `defaultEdgeOptions`:
```typescript
defaultEdgeOptions={{
  type: "smoothstep",
  markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 }
}}
```

**2. Update recursive edge labels:**
- `e6c-5`: label → `"🔄 AI responds again"`
- Make it visually distinct (animated already, good)

**3. Add two new recursive edges for the escalated path:**
- `e6bii-6bi`: source "6bii" → target "6bi", label "🔄 User replies again", orange, animated
- `e6bi-6bii`: source "6bi" → target "6bii", label "🔄 Agent replies again", orange, animated

**4. Update node descriptions:**
- 6c: mention "repeats until 👍 or 👎"
- 6bi/6bii: mention "can repeat indefinitely"

**5. Import `MarkerType` from `@xyflow/react`**

