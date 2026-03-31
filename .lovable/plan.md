

## Track Gmail threads by customer domain on Stats tab

### Problem
We want to show a breakdown of Gmail threads grouped by customer (identified by email domain), but the `gmail_conversations` table currently only stores the `from_email`. To determine the customer, we need the `to` and `cc` headers, then exclude `@lovable.dev` domains to find the customer domain.

### Database changes (migration)

Add two new columns to `gmail_conversations`:
- `to_emails text` — comma-separated list of To recipients
- `cc_emails text` — comma-separated list of CC recipients

### Edge function changes

**File: `supabase/functions/poll-gmail/index.ts`**
- Extract `To` and `Cc` headers alongside existing `From`, `Subject`, `Date`
- Store raw header values in the new `to_emails` and `cc_emails` columns on insert

### Stats page changes

**File: `src/pages/Stats.tsx`**

1. Update `GmailRow` interface to include `from_email`, `to_emails`, `cc_emails`
2. Update the Gmail query to fetch these new fields
3. Add a `useMemo` that:
   - For each Gmail thread (grouped by `gmail_thread_id` or subject), collects all email addresses from `from_email`, `to_emails`, and `cc_emails`
   - Filters out `@lovable.dev` domains
   - Extracts the domain (e.g., `sap.com` from `user@sap.com`)
   - Groups deduplicated threads by customer domain
4. Add a new card/chart section showing "Threads by customer" — a bar chart or ranked list of domains with thread counts

### Flow diagram update

**File: `src/pages/FlowDiagram.tsx`**
- Update the Gmail polling node to mention that `To`/`CC` headers are now captured for customer domain analytics

### Technical detail

Customer domain extraction logic:
```ts
function extractCustomerDomain(row: GmailRow): string | null {
  const allEmails = [row.from_email, row.to_emails, row.cc_emails]
    .filter(Boolean)
    .join(",")
    .split(",")
    .map(e => e.trim().toLowerCase())
    .filter(e => e.includes("@") && !e.endsWith("@lovable.dev"));
  
  if (allEmails.length === 0) return null;
  return allEmails[0].split("@")[1]; // first non-lovable domain
}
```

Thread grouping: same dedup-by-subject logic used for "Email total", but instead of counting totals, groups by extracted customer domain.

### Files to edit
- Migration: add `to_emails`, `cc_emails` columns
- `supabase/functions/poll-gmail/index.ts` — extract To/CC headers
- `src/pages/Stats.tsx` — customer domain breakdown metric
- `src/pages/FlowDiagram.tsx` — document change

### Note
Existing Gmail rows won't have `to_emails`/`cc_emails` populated. We can either backfill by re-polling, or accept that only new emails will have this data. The `from_email` alone can serve as a fallback for older rows (excluding `@lovable.dev` senders).

