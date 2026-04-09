

## Fix status dropdown text alignment

### Problem
The "Awaiting engineering" text in the status dropdown appears not left-aligned because the SelectValue span's truncated text isn't explicitly left-aligned.

### Solution
Add `text-left` class to the SelectTrigger on the status dropdown in `ConversationDetail.tsx`.

### Change

**`src/pages/ConversationDetail.tsx`** (line 1005)
Change:
```tsx
<SelectTrigger className="w-full">
```
To:
```tsx
<SelectTrigger className="w-full text-left">
```

This ensures the truncated status label stays left-aligned within the dropdown trigger.

### Files to edit
- `src/pages/ConversationDetail.tsx` — add `text-left` to status SelectTrigger

