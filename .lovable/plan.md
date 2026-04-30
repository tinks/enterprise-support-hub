# Add Intercom CSAT Capture & Stats

## Phase 1 — Schema (migration)

Add to both `manual_conversations` and `gmail_conversations`:
- `csat_rating smallint` (1–5, nullable)
- `csat_remark text` (nullable)
- `csat_rated_at timestamptz` (nullable)

Add a validation trigger (not CHECK) enforcing `csat_rating BETWEEN 1 AND 5` on insert/update. Partial indexes on `(csat_rating)` where `csat_rating IS NOT NULL` for both tables.

## Phase 2 — Capture in existing edge functions

Extract `conversation_rating` from Intercom API responses and write the three columns in:
- `poll-intercom-inbox` — on every poll cycle update for both `manual_conversations` and `gmail_conversations` rows linked by `intercom_conversation_id`.
- `intercom-webhook` — on `conversation_part` events, check `conversation.conversation_rating` and update the linked row.
- `import-intercom-ticket` — set on initial insert.
- `bulk-import-intercom` — set on initial insert.

Helper (inline in each function):
```ts
const rating = icData.conversation_rating;
const csatFields = rating ? {
  csat_rating: rating.rating,
  csat_remark: rating.remark || null,
  csat_rated_at: rating.created_at ? new Date(rating.created_at * 1000).toISOString() : null,
} : {};
```

## Phase 3 — Backfill + refresh

New edge function `refresh-intercom-csat`:
- One-time mode (`?mode=backfill`): page through all `manual_conversations` and `gmail_conversations` rows with non-null `intercom_conversation_id` and null `csat_rating`, fetch each from Intercom, write rating if present. Rate-limit ~5 req/sec.
- Recurring mode (default): only conversations resolved in the last 14 days with null `csat_rating` (CSAT typically arrives hours/days after resolution).
- Schedule via `pg_cron` every 6 hours using `net.http_post` (insert SQL, not migration).

## Phase 4 — Stats UI (`src/pages/Stats.tsx`)

New section "Customer satisfaction":
- KPI cards: **Avg CSAT** (1–5, 1 decimal), **Response rate** (% of resolved Intercom-linked tickets with a rating), **Total ratings**.
- Distribution chart: horizontal bar, counts per 1–5 rating, color-graded red→green.
- Recent low ratings list: 1–2 star ratings in range, click-through to `/conversations/:source/:id`.
- Respect existing date range / source / owner filters.
- Pull from both `manual_conversations` and `gmail_conversations` via existing query patterns (just select the new columns).

## Files touched

- `supabase/migrations/<new>_add_csat_columns.sql` — columns + trigger + indexes.
- `supabase/functions/poll-intercom-inbox/index.ts` — capture rating on poll.
- `supabase/functions/intercom-webhook/index.ts` — capture rating on webhook.
- `supabase/functions/import-intercom-ticket/index.ts` — capture on import.
- `supabase/functions/bulk-import-intercom/index.ts` — capture on bulk import.
- `supabase/functions/refresh-intercom-csat/index.ts` — new, backfill + refresh.
- `supabase/config.toml` — register `refresh-intercom-csat` with `verify_jwt = false`.
- `src/pages/Stats.tsx` — CSAT section.
- `.lovable/project-knowledge.md` + new `.lovable/memory/features/csat.md` — document the flow.
- `src/pages/FlowDiagram.tsx` — add CSAT capture node.
- One pg_cron `INSERT` SQL (run via insert tool, not migration) to schedule the refresh.

## Out of scope

- Slack-only conversations (no Intercom link → no CSAT).
- Triggering CSAT requests (Intercom owns that flow).
- Editing/overriding ratings from the UI.
