

## Exclude internal-only Gmail threads from all metrics

### Problem
Gmail threads where every participant is `@lovable.dev` (internal emails) are currently counted in "Email total", "Gmail messages", "Gmail open", and all other Gmail metrics. They should be excluded entirely.

### Changes

**File: `src/pages/Stats.tsx`**

1. Add a helper function `isInternalOnly(g: GmailRow): boolean` that collects all email addresses from `from_email`, `to_emails`, and `cc_emails`, parses RFC format (`Name <email>`), and returns `true` if every address ends with `@lovable.dev` (or if no addresses found).

2. Update the `filteredGmail` memo to add `.filter(g => !isInternalOnly(g))` — this single change propagates to all downstream metrics (Email total, Gmail messages, Gmail open, Gmail resolved, resolution times, customer domains, volume chart) since they all derive from `filteredGmail`.

**File: `src/pages/FlowDiagram.tsx`**
- Add a note to the Gmail analytics node documenting that internal-only threads (all participants `@lovable.dev`) are excluded from all metrics.

### Technical detail
```ts
function isInternalOnly(g: GmailRow): boolean {
  const raw = [g.from_email, g.to_emails, g.cc_emails].filter(Boolean).join(",");
  const emails = raw.split(",").map(e => {
    const match = e.match(/<([^>]+)>/);
    return (match ? match[1] : e).trim().toLowerCase();
  }).filter(e => e.includes("@"));
  if (emails.length === 0) return true;
  return emails.every(e => e.endsWith("@lovable.dev"));
}
```

Filter applied once at source:
```ts
const filteredGmail = useMemo(() => {
  // ...existing date/view filters...
  return gmailData.filter(g => matchView && matchRange && !isInternalOnly(g));
}, [...]);
```

