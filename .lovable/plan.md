

## Update default column order

### What changes
Update the `ALL_COLUMNS` constant to match the actual desired default order. Also note "incident" likely maps to "bug" (the existing column).

### Implementation

**`src/pages/Conversations.tsx`** (line 125)

Change `ALL_COLUMNS` from:
```ts
["id", "source", "sent_by", "message", "channel", "link", "intercom", "status", "owner", "date", "test", "resolved", "product_area", "bug", "classification"]
```
to:
```ts
["id", "date", "channel", "message", "status", "owner", "product_area", "sent_by", "classification", "source", "link", "intercom", "test", "resolved", "bug"]
```

This also clears any saved column order in localStorage on first load so users see the new default.

### Files to edit
- `src/pages/Conversations.tsx`

