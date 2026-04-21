

## Why this conversation shows up "today" in analytics

### What's happening

Gmail thread `19d9ce644175475b` ("Re: Lovable Git Sync Issue") has 3 rows in `gmail_conversations`:

| Row | from | received_at |
|---|---|---|
| `a9ea5c87…` | fadi@lovable.dev | Apr 17 19:23 |
| `efd23787…` | support@lovable.dev | Apr 17 19:24 |
| **`2f9cf42f…`** | support@lovable.dev | **Apr 20 11:16** |

All three correctly share `gmail_thread_id = 19d9ce644175475b` and `intercom_conversation_id = 215473963341741`.

The Stats page deduplicates Gmail by thread (one row per thread) — but the dedup picks **the latest row** per thread, not the earliest:

```ts
// src/pages/Stats.tsx line 247–262
filteredGmail.forEach((g) => {
  const key = g.gmail_thread_id || `__orphan_${orphanIdx++}`;
  const existing = threadMap.get(key);
  if (!existing) {
    threadMap.set(key, g);
  } else {
    if (newDate > existingDate) threadMap.set(key, g);  // <-- keeps newest
  }
});
```

So the surviving "representative row" for that thread is `2f9cf42f…` with `received_at = 2026-04-20 11:16`. Then every downstream chart that uses `filteredGmailThreads` (volume chart, hourly activity, heatmap, total counts, customer-domain) buckets the thread on Apr 20 instead of Apr 17.

### The fix

Change the Gmail thread dedup to keep the **earliest** row per thread, so the thread is bucketed by when the conversation actually started. Resolution-time math (`gmailResolutionTimes`, lines 292–311) already uses the earliest message, so this aligns volume bucketing with how we already think about thread start time.

### Concretely

- **Edit `src/pages/Stats.tsx` lines 247–262**: flip the comparator so the dedup keeps the row with the earliest `received_at || created_at`.
- This is a one-line change (`>` → `<`). Everywhere `filteredGmailThreads` is consumed (volume chart, KPI counters, hourly activity, heatmap, customer-domain) automatically benefits.

### Impact

- This thread (and any other multi-day Gmail thread where a reply landed in a later range bucket) will now show on its origin date — Apr 17 here, not Apr 20.
- Resolution counts unaffected (uses raw rows, not the deduped one).
- "Currently active conversations" (uses `status`) unaffected — status is the same on every sibling.
- KPI "Gmail unique threads" count unaffected — same number of distinct threads, just attributed to the earlier date.

### Update memory

- Update `mem://logic/gmail-thread-dedup` to specify "keep earliest row per thread" (currently it doesn't pin a direction).

### Out of scope

- Changing the underlying schema or backfilling anything — purely a client-side aggregation fix.
- Touching the resolution-time pipeline (already correct).

