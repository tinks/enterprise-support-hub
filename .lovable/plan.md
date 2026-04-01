

## Fix: import tab not showing "already imported" message for duplicate threads

### Problem
When importing an already-imported thread, the edge function returns 409 with `{"error":"...","existingId":"..."}`. But `supabase.functions.invoke` treats any non-2xx as an error, putting a generic message in `error` and potentially nullifying `data`. The code checks `error` first (line 55) and shows the generic message, never reaching the `data?.error` branch (line 60) that has the nice "Already imported" toast with the "View" link.

### Fix

**`src/components/ImportTab.tsx`**

Change the error handling to parse the response body even on error. `supabase.functions.invoke` returns the parsed body in `data` even on non-2xx in newer versions, but the `error` check short-circuits. Fix by checking `data` first, or by combining:

```ts
if (error) {
  // Even on error, data may contain structured response
  if (data?.existingId) {
    toast.error("Already imported", {
      description: "This thread already exists in conversations.",
      action: {
        label: "View",
        onClick: () => navigate(`/conversations/${data.existingId}`),
      },
    });
  } else {
    toast.error(data?.error || error.message || "Import failed");
  }
  return;
}
```

This ensures the 409 duplicate case shows the friendly message with the "View" action button, while other errors still show their messages.

**`src/pages/FlowDiagram.tsx`** — Document that import error handling now properly surfaces structured error responses.

### Files to edit
- `src/components/ImportTab.tsx` — merge error + data handling
- `src/pages/FlowDiagram.tsx` — document change

