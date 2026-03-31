

## Make conversation table headers sticky on scroll

### Problem
When scrolling the conversations table, the column headers scroll out of view.

### Fix
Add `sticky top-0 z-10 bg-card` to the `TableHeader` element in `Conversations.tsx` so the header row stays pinned while the table body scrolls. The wrapping `div` in the `Table` component already has `overflow-auto`, so sticky positioning will work natively.

### Changes

**`src/pages/Conversations.tsx`** — line 363
Add className to `<TableHeader>`:
```tsx
<TableHeader className="sticky top-0 z-10 bg-card">
```

### Files to edit
- `src/pages/Conversations.tsx` — 1 line change

