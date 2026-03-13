

## Add export functionality to the flow diagram

### Approach
Add a download/export button to the flow page that captures the entire diagram as a PNG image using React Flow's built-in `toObject()` combined with the `html-to-image` library (`toPng`) and the `@xyflow/react` `useReactFlow` hook plus `getNodesBounds` / `getViewportForBounds`.

React Flow's recommended approach uses `html-to-image` to capture the `.react-flow__viewport` element as a high-res PNG.

### Changes

**1. Install `html-to-image`** — lightweight library for DOM-to-image conversion.

**2. `src/pages/FlowDiagram.tsx`**
- Import `useReactFlow`, `getNodesBounds`, `getViewportForBounds` from `@xyflow/react`
- Add a "Download PNG" button (using the existing `Button` component + `Download` icon) positioned in the top-right corner of the flow container
- On click: capture the `.react-flow__viewport` element at 2x resolution, trigger a file download
- Wrap `ReactFlow` in a `ReactFlowProvider` (required for `useReactFlow` hook) by splitting into an inner component

**3. Implementation detail**
- The export captures the full diagram (all nodes), not just the visible viewport
- Uses `getNodesBounds` to compute the bounding box of all nodes, then `getViewportForBounds` to set the correct transform
- Renders at 2x scale for crisp sharing

