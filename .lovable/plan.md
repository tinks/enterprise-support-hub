## Goal

Extend the Insights tab so monthly AI clustering covers **all conversation sources** — Intercom (`conversation_mappings`), Gmail (`gmail_conversations`), and Manual/DM (`manual_conversations`) — not just Intercom.

## Approach

Keep the same 3-pass AI flow (discover buckets → assign tickets → executive summary), but feed it a unified ticket list from all sources.

### 1. Edge function `analyze-intercom-month` → rename behavior to `analyze-month`

Keep the same function name to avoid breaking anything, but change its internals:

- Pull from three tables for the month window (using `created_at` for Intercom/Manual, `received_at` for Gmail), excluding `is_test`.
- Normalize each row into a common shape:
  ```
  { id, source: 'intercom'|'gmail'|'manual', subject, body, product_area, created_at }
  ```
  - Intercom: `subject` = first line of `original_message_text`, `body` = `original_message_text`
  - Gmail: `subject` = `subject`, `body` = `snippet` (or first message body if available)
  - Manual: `subject` = `subject`, `body` = first `manual_messages.message_text` for that conversation (one extra query)
- Deduplicate Gmail by `gmail_thread_id` (per existing memory rule), keep earliest row per thread.
- Run the same 3 AI passes against the unified list.
- Store `source` per ticket in the bucket's `tickets` array so the UI can deep-link correctly.

### 2. `monthly_insights` table

Change `source` semantics:
- Use `source = 'all'` for the new combined report (keeps the unique key `(month, source)` working and preserves any existing Intercom-only rows).
- No schema migration needed — `source` is already a free text column.

Bucket JSON shape gains per-ticket source:
```json
{
  "name": "...",
  "description": "...",
  "count": 12,
  "product_areas": { "SSO": 4, "Other": 8 },
  "tickets": [
    { "id": "uuid", "source": "intercom", "subject": "...", "product_area": "SSO" }
  ]
}
```

### 3. UI — `src/pages/Insights.tsx`

- Default fetch: `source = 'all'`.
- Header: show total count split as `Intercom 153 · Gmail 41 · Manual 12`.
- Bucket cards: add a small source breakdown chip row (e.g. `Intercom 8 · Gmail 3 · Manual 1`).
- Drawer ticket list: show a source badge next to each subject, and route to the correct conversation detail page based on `source`.
- "Regenerate" button calls the same edge function (now multi-source).

### 4. Out of scope

- No Slack-only standalone source (Slack tickets are already represented via `conversation_mappings`, which is the Intercom-bridged record — that's what "Slack+DM" maps to in this app).
- No changes to other pages (Stats, Conversations, etc.).
- No auto-cron yet.

## Files to change

- `supabase/functions/analyze-intercom-month/index.ts` — add Gmail + Manual fetching, unify, keep AI logic
- `src/pages/Insights.tsx` — source filter defaults to `'all'`, render source breakdowns + correct deep links
- `.lovable/project-knowledge.md` + memory index — note multi-source coverage

## Open question

The existing April Intercom-only report (`source = 'intercom'`) — keep it as a separate historical row, or overwrite by switching the default view to `'all'` and leaving the old row untouched? Default plan: **leave old row untouched, generate a new `'all'` row**, UI only shows `'all'`.
