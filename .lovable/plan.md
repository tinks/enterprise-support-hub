

## Hybrid Gmail resolution tracking

### Overview
Add manual status tracking for Gmail threads with an automated 24-hour inactivity auto-close. This enables resolution time metrics for Gmail on the Stats page.

### Database changes (migration)

1. **Add columns to `gmail_conversations`**:
   - `status text NOT NULL DEFAULT 'open'` — values: `open`, `resolved`
   - `resolved_at timestamptz` — set when resolved (manually or by auto-close)

2. **Create a database function + pg_cron job** for auto-close:
   - Function scans for `gmail_thread_id` groups where the latest `received_at` is older than 24 hours and `status = 'open'`
   - Sets `status = 'resolved'` and `resolved_at = now()` on all open rows in those threads
   - Cron runs every hour

### UI changes

**File: `src/pages/Conversations.tsx`**
- Add a status badge for Gmail rows (currently shows hardcoded "email") — display actual `status` value
- Add a manual "Resolve" button or status toggle for Gmail rows so users can close threads early

**File: `src/pages/Stats.tsx`**
- Update `GmailRow` interface to include `status` and `resolved_at`
- Update Gmail query to fetch `status, resolved_at`
- Add Gmail resolution metrics when source includes Gmail:
  - Resolved count, Open count
  - Median / average resolution time (difference between first message `received_at` per thread and `resolved_at`)
- These appear in the Gmail section of the stats cards

**File: `src/pages/FlowDiagram.tsx`**
- Update the Gmail polling node to document the hybrid resolution tracking: manual resolve + 24h auto-close

### Technical detail

Resolution time calculation per thread:
```text
thread_start = MIN(received_at) WHERE gmail_thread_id = X
thread_resolved = resolved_at of any row in thread (all share same value)
resolution_minutes = resolved_at - thread_start
```

Auto-close SQL (runs hourly):
```sql
UPDATE gmail_conversations
SET status = 'resolved', resolved_at = now()
WHERE status = 'open'
  AND gmail_thread_id IN (
    SELECT gmail_thread_id FROM gmail_conversations
    WHERE status = 'open' AND gmail_thread_id IS NOT NULL
    GROUP BY gmail_thread_id
    HAVING MAX(received_at) < now() - interval '24 hours'
  );
-- Also close orphan rows (no thread_id) older than 24h
UPDATE gmail_conversations
SET status = 'resolved', resolved_at = now()
WHERE status = 'open'
  AND gmail_thread_id IS NULL
  AND received_at < now() - interval '24 hours';
```

### Files to edit
- Migration: add `status` + `resolved_at` columns, create auto-close function + cron
- `src/pages/Conversations.tsx` — Gmail row status display + manual resolve
- `src/pages/Stats.tsx` — Gmail resolution metrics
- `src/pages/FlowDiagram.tsx` — document the change

