## How it works

### The index table

One migration creates `public.esh_search_index`:

- `kind` — `v3_ticket`, `note`, `escalation`, `backlog`, `customer`, `severity_proposal`, later `gmail`, `manual`.
- `ref_id` — the natural key (Intercom conversation id, or the row uuid).
- `title`, `body`, `meta jsonb`, `url_path` (where a click lands), `source_updated_at`.
- `tsv` — a generated `tsvector` over title + body, GIN indexed.
- `pg_trgm` extension plus a trigram index on `title` and on an `idents` column holding the compact tokens (Linear keys, Intercom ids, Slack channel ids, workspace/project UUIDs, domains) so partial matches like `SCA-35` work.

Read access follows the existing authenticated-user RLS pattern; writes are `service_role` / the refresh function only.

### Body extraction

v3 conversation text is already in `raw_payload->'conversation_parts'`. The refresh function walks the parts, strips HTML tags, and concatenates author + body into the `body` column. Attribute text (`custom_attributes`) and `tags` are flattened into the same field so "Escalated Issue" values are searchable as plain text.

### Refresh

`public.esh_refresh_search_index(p_full boolean default false)` upserts rows whose source `updated_at` is newer than what the index holds. Scheduled every 15 minutes via `pg_cron` alongside the existing Hub jobs, plus a **Reindex now** button on the search page showing last-refresh time and row count. Nothing in the sync path changes — the index is derived, never authoritative.

### Query

`public.esh_deep_search(p_q text, p_kinds text[] default null, p_limit int default 100)`:

1. `websearch_to_tsquery` against `tsv` for phrase and multi-word queries, ranked with `ts_rank_cd`.
2. Union with a trigram match on `idents`/`title` for short or partial identifier queries.
3. Returns `kind, ref_id, title, url_path, snippet` where the snippet comes from `ts_headline` with the match highlighted.

### UI

New route `/search` ("Deep search" in the sidebar), one input, debounced. Results grouped by kind with a count per group and a kind filter row. Each hit shows title, highlighted snippet, and context (customer, state, date), linking to the conversation detail sheet, the escalations board, or the backlog item. Read-only — no writes anywhere.

## Boundaries

- No existing search box, filter, or population gate changes.
- No change to sync functions, `v3_derive_customer`, triggers, or the SLA engine.
- The index is rebuildable from scratch at any time; dropping it loses nothing.

## Documentation

Changelog entry, a FlowDiagram node for the index/refresh/query path, and a `.lovable/project-knowledge.md` update staged through `sync-knowledge-pending`.

## Open question

Phase 2 covers Gmail and manual conversations (~1,300 + ~1,200 threads, 9,600 messages). Worth including, or is deep search only meaningful over the v3 enterprise population?
