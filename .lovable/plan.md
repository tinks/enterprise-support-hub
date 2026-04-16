

## Fix Gmail thread duplication in analytics and prevent future inflation

### Problem
The `poll-gmail` function creates one row per Gmail **message**, so a thread with 5 replies produces 5 rows in `gmail_conversations`. This causes:

- **Analytics inflation**: `gmailTotal` in Stats uses raw row count (149 rows vs 31 actual threads = ~4x overcounting)
- **Volume chart partially mitigated**: dedupes by exact subject per day, but subject variations (Re:/Fwd:) within a thread still slip through
- **Metadata orphans**: 21/24 rows in the largest thread have no `owner` — only the triaged row gets metadata, skewing classification percentages
- **Recently imported list**: shows duplicate entries per thread (already planned separately)

### Current state
- **149 total Gmail rows** representing only **31 unique threads** = **118 excess rows**
- Conversations page already groups by `gmail_thread_id` — unaffected
- Resolution time stats already group by thread — unaffected
- `gmailUniqueEmails`, `gmailTotal`, and `mergedVolumeData` do NOT deduplicate by thread

### Changes

**1. Fix Stats.tsx — deduplicate Gmail by thread across all metrics**
- After `filteredGmail` is computed, derive a `filteredGmailThreads` memo that keeps only one representative row per `gmail_thread_id` (latest `received_at`)
- Use `filteredGmailThreads` for: `gmailTotal` count, `gmailUniqueEmails`, volume charts, resolved/open counts, and customer domain analysis
- Keep raw `filteredGmail` for resolution time calculation (already groups correctly)

**2. Fix poll-gmail — propagate metadata to all siblings on insert**
- The inheritance logic (lines ~180-195 in poll-gmail) already copies metadata from an existing sibling, but only if that sibling has `owner IS NOT NULL`
- Problem: the first message arrives before triage, so it has no metadata. Later messages may copy from a still-untriaged sibling
- Add: when a user updates metadata on any Gmail row (already handled by `gmail-thread-sync` in ConversationDetail), no poll-gmail change needed — the sync already propagates

**3. Backfill historic orphan rows — one-time data fix**
- Run an UPDATE to propagate `owner`, `classification`, `product_area`, `is_bug`, `is_feature_request`, `status`, `resolved_at` from the triaged sibling to all untriaged siblings in the same thread
- This fixes the 118 historic orphan rows

**4. Fix ImportTab.tsx — deduplicate recently imported by thread**
- Already planned in the approved dedup plan; include `gmail_thread_id` in the query and keep only latest row per thread

**5. Update Flow diagram**
- Add a note to the Gmail polling node indicating thread-level deduplication in analytics

### Files
- **Edit**: `src/pages/Stats.tsx` — add `filteredGmailThreads` memo, use it in all Gmail KPI calculations
- **Edit**: `src/components/ImportTab.tsx` — deduplicate recent imports by `gmail_thread_id`
- **Edit**: `src/pages/FlowDiagram.tsx` — update Gmail node description
- **Migration**: one-time SQL to backfill orphan metadata from triaged siblings

### Migration SQL (preview)
```sql
UPDATE gmail_conversations AS target
SET
  owner = source.owner,
  classification = source.classification,
  product_area = source.product_area,
  is_bug = source.is_bug,
  is_feature_request = source.is_feature_request,
  status = source.status,
  resolved_at = source.resolved_at
FROM (
  SELECT DISTINCT ON (gmail_thread_id)
    gmail_thread_id, owner, classification, product_area,
    is_bug, is_feature_request, status, resolved_at
  FROM gmail_conversations
  WHERE gmail_thread_id IS NOT NULL AND owner IS NOT NULL
  ORDER BY gmail_thread_id, received_at DESC
) AS source
WHERE target.gmail_thread_id = source.gmail_thread_id
  AND target.owner IS NULL;
```

