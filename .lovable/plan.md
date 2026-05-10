## Goal
After the inbox audit flags out-of-inbox Intercom tickets as `is_test=true`, automatically purge cached `monthly_insights` for any month that contained those tickets so they regenerate fresh (excluding test rows).

## Changes

### 1. `audit-out-of-inbox-tickets` edge function
On `apply: true`, after flipping `is_test=true`:
- Collect the set of YYYY-MM months derived from each flagged record's `created_at` (manual/gmail) or the linked `manual_conversations.created_at` for `conversation_mappings`.
- `DELETE FROM monthly_insights WHERE source = 'intercom' AND month = ANY(months)`.
- Include `purgedMonths: string[]` in the response.

### 2. Insights UI (`src/pages/Insights.tsx`)
- When the selected month has no cached `monthly_insights` row, the existing "Generate topics" flow already handles regeneration — no change needed beyond surfacing the purge result.
- Minor: add a toast/note in the Settings audit card showing "Purged insights for N months" after apply.

### 3. Settings audit card (`src/pages/Index.tsx`)
- Display `purgedMonths` from the apply response.

### 4. Knowledge updates
- Append a note to `.lovable/project-knowledge.md` and `mem://logic/enterprise-inbox-guard` explaining that flagging cascades to insight cache invalidation.

## Out of scope
- No automatic LLM regeneration (user opens Insights and clicks "Generate topics" per month).
- No changes to analytics/stats — those already filter `is_test=false` live.

## Files
- `supabase/functions/audit-out-of-inbox-tickets/index.ts`
- `src/pages/Index.tsx`
- `.lovable/memory/logic/enterprise-inbox-guard.md`
- `.lovable/project-knowledge.md`
