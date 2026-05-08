## Goal

Stop maintaining the hardcoded `**Last updated:** 2026-04-29` line in the knowledge doc. Show the real `updated_at` from the `knowledge_documents` row in the `/knowledge` page header instead.

## Changes

1. **`src/pages/ProjectKnowledge.tsx`**
   - Already selects the row from `knowledge_documents`. Add `updated_at` to the select.
   - Render a small "Last updated {formatted updated_at}" line in the page header, near the title (above the markdown body).
   - Use `date-fns` `format` (already used elsewhere) for a readable date+time.

2. **`.lovable/project-knowledge.md`**
   - Remove line 3 (`> **Last updated:** 2026-04-29 (...)`) so the markdown body no longer carries a stale date.

3. **`knowledge_documents` row (`id = 'project-knowledge'`)**
   - Stage the updated markdown (without the Last updated line) into `pending_content` with `pending_summary = "Removed hardcoded Last updated line; surfaced live updated_at in /knowledge header"` and `pending_at = now()`.
   - You then approve on `/knowledge` as usual. Once approved, `content` no longer has the stale string and the header shows the real DB timestamp.

## Out of scope

- Auto-syncing the .md file to the DB row.
- Any other knowledge content edits.
