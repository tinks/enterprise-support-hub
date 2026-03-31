

## Add drag-and-drop column reordering to conversations table

### Approach
Use the HTML5 Drag and Drop API (no extra dependencies) to let you grab column headers and rearrange them. The new order persists in `localStorage` so it survives refreshes but remains easy to reset.

### Changes

**`src/pages/Conversations.tsx`**

1. Define a column config array with keys matching each current `TableHead`:
   ```ts
   const ALL_COLUMNS = ["id", "source", "sent_by", "message", "channel", "link", "intercom", "status", "date", "test", "resolved", "product_area", "bug", "feature_req"] as const;
   ```

2. Add state for column order, initialized from `localStorage` (falling back to `ALL_COLUMNS`):
   ```ts
   const saved = localStorage.getItem("conv-column-order");
   const [columnOrder, setColumnOrder] = useState<string[]>(saved ? JSON.parse(saved) : [...ALL_COLUMNS]);
   ```
   Persist on change via `useEffect`.

3. Add drag state (`draggedCol`, `dragOverCol`) and handlers:
   - `onDragStart` — store the dragged column key
   - `onDragOver` — track the drop target, prevent default
   - `onDrop` — reorder the array, update state
   - Visual feedback: highlight the drop target header with a left-border accent

4. Refactor the table rendering to be column-driven:
   - Create a `columnDefs` map: `{ id: { header: "#", renderSlack: (m) => ..., renderGmail: (g) => ... } }`
   - `TableHeader` iterates `columnOrder` and renders each `TableHead` with drag attributes
   - `TableBody` rows iterate `columnOrder` and render the matching `TableCell` for each column
   - This replaces the current hardcoded header/cell order with a data-driven approach

5. Add a small "Reset columns" button (e.g. next to the existing filters) that clears `localStorage` and resets to `ALL_COLUMNS`.

**`src/pages/FlowDiagram.tsx`** — Document that column headers are draggable for reordering.

### Files to edit
- `src/pages/Conversations.tsx` — column config, drag handlers, data-driven rendering
- `src/pages/FlowDiagram.tsx` — document change

