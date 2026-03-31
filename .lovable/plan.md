

## Make conversations table scroll independently instead of the full page

### Problem
The entire page scrolls, so the table headers (even though they're `sticky`) scroll with the page body. The fix is to make the AppLayout fill the viewport and give the conversations content area a constrained height with its own scroll.

### Changes

**`src/components/AppLayout.tsx`** (line 9)
Change the root div from `min-h-screen` to `h-screen flex flex-col overflow-hidden`, and wrap `{children}` in a `flex-1 min-h-0 overflow-auto` container:

```tsx
<div className="h-screen flex flex-col overflow-hidden bg-background">
  <nav>…</nav>
  <div className="h-0.5 …" />
  <div className="flex-1 min-h-0 overflow-auto">
    {children}
  </div>
</div>
```

This constrains the page to the viewport height. The nav stays fixed at the top, and only the content area (children) scrolls. The `sticky top-0` on `TableHeader` will then work correctly within the scrolling container.

### Files to edit
- `src/components/AppLayout.tsx` — 3-line layout change

