

## Deduplicate Gmail resolved count by subject

### Problem
Line 318 in `Stats.tsx` counts every `gmail_conversations` row with `status === 'resolved'` individually. When multiple rows share the same subject (same email thread), toggling them all resolved counts each one — inflating the resolved metric. It should count as 1 resolved thread per unique subject, matching the "Email total" dedup logic.

### Change

**`src/pages/Stats.tsx`** — Replace the simple `.filter().length` with subject-based dedup:

```tsx
// Current (line 318):
const gmailResolved = filteredGmail.filter((g) => g.status === "resolved").length;

// New:
const gmailResolvedSubjects = new Set<string>();
let gmailResolvedOrphans = 0;
filteredGmail.forEach((g) => {
  if (g.status !== "resolved") return;
  if (g.subject) gmailResolvedSubjects.add(g.subject);
  else gmailResolvedOrphans++;
});
const gmailResolved = gmailResolvedSubjects.size + gmailResolvedOrphans;
```

Same dedup approach as the existing `gmailUniqueEmails` memo — group by subject, count unique subjects. Rows without a subject each count individually.

Apply the same pattern to `gmailOpen` for consistency.

**`src/pages/FlowDiagram.tsx`** — Document the dedup logic for Gmail resolved counting.

### Files to edit
- `src/pages/Stats.tsx` — deduplicate gmailResolved and gmailOpen by subject
- `src/pages/FlowDiagram.tsx` — document the change

