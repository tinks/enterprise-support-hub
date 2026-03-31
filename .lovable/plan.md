

## Deduplicate Gmail emails by subject and add "Email total" metric

### Problem
Currently, each Gmail message row is counted individually. Emails with the same subject (i.e. thread replies) should be grouped as 1 email thread. A new "Email total" metric should show this deduplicated count on the Stats page.

### Changes

**File: `src/pages/Stats.tsx`**

1. **Expand GmailRow interface** — add `subject: string | null` field.

2. **Update the Gmail query** — change the select from `"received_at, created_at, is_test"` to `"received_at, created_at, is_test, subject"` so subject data is available for deduplication.

3. **Add `gmailUniqueEmails` useMemo** — group `filteredGmail` by `subject` (treating null/empty subjects as individual items), count unique subjects. This is the "Email total" number.

4. **Add to `stats` object** — add `emailTotal` (the unique subject count) alongside existing `gmailTotal`.

5. **Add "Email total" summary card** — new card shown when source is not "slack", displaying `stats.emailTotal` with a `Mail` icon and label "Email total". Place it next to the existing "Gmail emails" card. The existing "Gmail emails" card becomes "Gmail messages" to distinguish raw count from deduplicated count.

6. **Update volume chart (optional)** — the Gmail volume data already counts per-message; no change needed since the "Email total" card is the primary metric.

### Technical detail
- Deduplication logic: `new Set(filteredGmail.map(g => g.subject || g.gmail_message_id)).size` — null/empty subjects fall back to message ID so they count individually.
- Wait — `gmail_message_id` isn't on `GmailRow`. Simpler: null subjects each count as 1 unique email. Use a counter: group by subject, null subjects each get their own bucket.

```ts
const gmailUniqueEmails = useMemo(() => {
  const subjects = new Set<string>();
  let nullCount = 0;
  filteredGmail.forEach(g => {
    if (g.subject) subjects.add(g.subject);
    else nullCount++;
  });
  return subjects.size + nullCount;
}, [filteredGmail]);
```

