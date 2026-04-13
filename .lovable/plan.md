

## Combine reply, notes, and activity log into tabbed interface

### What changes
Replace the three separate cards (Reply to customer, Internal notes, Activity log) below the conversation thread with a single `<Tabs>` component. The default tab is "Reply to customer".

### Layout

```text
┌─────────────────────────────────────────────────┐
│  [Messages / thread content]                    │
│                                                 │
├─────────────────────────────────────────────────┤
│  Reply to customer │ Internal notes │ Activity  │
│  ─────────────────                              │
│  [Tab content here]                             │
└─────────────────────────────────────────────────┘
```

### Technical details

**File: `src/pages/ConversationDetail.tsx`**
- Import `Tabs, TabsList, TabsTrigger, TabsContent` from `@/components/ui/tabs`
- Replace lines ~922–1014 (the three separate Card sections for reply, notes, and activity log) and lines ~1183–1220 (activity log in sidebar — move it here) with a single `<Tabs defaultValue="reply">` block containing:
  - `TabsTrigger value="reply"` → "Reply to customer"
  - `TabsTrigger value="notes"` → "Internal notes"  
  - `TabsTrigger value="activity"` → "Activity log" (with badge count)
- Each `TabsContent` contains the existing card body content (no outer `<Card>` wrapper needed — the tabs container replaces it)
- Remove the Activity log `<Collapsible>` from the right sidebar (lines ~1183–1220) since it moves into the tabs
- Remove the now-unused `auditOpen`/`setAuditOpen` state and `Collapsible` import if no longer used elsewhere

**File: `src/pages/FlowDiagram.tsx`**
- Update documentation to reflect the new tabbed UI layout

### Files to edit
- `src/pages/ConversationDetail.tsx`
- `src/pages/FlowDiagram.tsx`

