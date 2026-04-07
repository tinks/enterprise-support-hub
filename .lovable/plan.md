

## Sort product areas alphabetically with "Other" pinned at the bottom

### Problem
Product areas are displayed in insertion order everywhere. They should be sorted alphabetically, with "Other" always appearing last.

### Solution

Apply a sort helper wherever product areas are parsed into an array. The sort places "Other" (case-insensitive) at the end, and sorts everything else alphabetically.

**`src/components/ProductAreasCard.tsx`**
- Sort the `areas` array displayed in the badge list: alphabetical, "Other" last

**`src/pages/Conversations.tsx`**
- Sort `productAreas` state after loading from settings (~line 662)

**`src/pages/ConversationDetail.tsx`**
- Sort `productAreas` state after loading from settings (~line 202)

### Sorting logic (used in all three files)
```typescript
.sort((a, b) => {
  if (a.toLowerCase() === "other") return 1;
  if (b.toLowerCase() === "other") return -1;
  return a.localeCompare(b);
})
```

### Files to edit
- `src/components/ProductAreasCard.tsx`
- `src/pages/Conversations.tsx`
- `src/pages/ConversationDetail.tsx`

