## Auto-categorize uncategorized tickets (product area)

May 2026 currently has **239 uncategorized** tickets (24 Slack, 120 Gmail, 95 manual). The existing `auto-classify-conversations` function fills `classification` (Issue/Bug/FR/…) but does NOT touch `product_area`, which is what the Insights "Uncategorized tickets" panel measures. So I'll add a sibling function and a button.

### 1. New edge function `auto-categorize-product-area`

Mirrors `auto-classify-conversations`:

- Reads the configured `product_areas` list from `settings` (currently 18 areas including SSO, SCIM, Credits, Billing, Cloud/AI, Main Product, Other, …) and uses them as the enum for the AI tool-call schema.
- Accepts `{ from, to, ids?, dryRun?, minConfidence? (default 0.5) }`.
- Pulls rows from `conversation_mappings` / `gmail_conversations` / `manual_conversations` where `product_area IS NULL OR product_area = 'Uncategorized'`, `is_test = false`, within the date range. For manual rows, also pulls the first non-internal `manual_messages` body for context, same pattern as the existing function.
- Optional `excludeInternal: true` filter to skip `from_email` ending in `lovable.dev` for gmail rows (matches the panel's "Hide internal lovable.dev senders" default).
- Calls Lovable AI Gateway (`google/gemini-3-flash-preview`, same as existing) with a tool-call returning `{ product_area, confidence, reason }`. Falls back to "Other" only if the model explicitly picks it.
- Writes `product_area` directly on the row. For Gmail, propagates to siblings sharing `gmail_thread_id` (matches `UncategorizedPanel.persist`).
- Inserts a `conversation_audit_logs` row per write with `performed_by = 'auto-categorize'`.
- Returns `{ total, written, lowConfidence, failed, results[] }`.

### 2. UI: "Auto-categorize visible" button in `UncategorizedPanel`

- New button next to the bulk-edit bar. Invokes the new edge function with `from` / `to` of the selected month and `ids` = currently visible IDs (so the Hide-internal + Source filters are honored).
- Shows progress toast → on success calls `onChanged?.()` so the parent refetches and the panel refreshes.

### 3. One-shot run for May 2026

After the function deploys, I'll invoke it once via `curl_edge_functions` with `from=2026-05-01T00:00:00Z`, `to=2026-06-01T00:00:00Z`, `excludeInternal=true` to clear May's backlog. Report the written/low-confidence/failed counts.

### Knowledge updates

- Add `mem://features/auto-categorize-product-area` memory leaf.
- Update `.lovable/project-knowledge.md` and the Flow page with the new function node.

### Out of scope

- No changes to the existing `auto-classify-conversations` function (different field).
- No cron schedule — run on demand from the panel only, for now.
