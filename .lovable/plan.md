## Root cause

`/knowledge` reads from the `knowledge_documents` row (`id = 'project-knowledge'`). That row was last updated 2026-04-29 and has `pending_content = NULL`, so `ProjectKnowledge.tsx` shows no diff and no Approve button. All recent doc updates this session went only to the file `.lovable/project-knowledge.md` (used by the AI), not the DB-backed copy.

## Fix

Stage the current `.lovable/project-knowledge.md` content (40 KB+, with the new CSAT remark surfacing section, the "Intercom assign and reply parts" section, and the assignment-part picker note) into `knowledge_documents.pending_content` for the `project-knowledge` row, with a `pending_summary` listing what changed and `pending_at = now()`.

After this runs, the Approve / Reject controls appear on `/knowledge` with a side-by-side diff. You click Approve and the new text becomes the live `content`; reject keeps the old.

## Steps

1. Read `.lovable/project-knowledge.md` from disk.
2. Run a Supabase update on `knowledge_documents` where `id = 'project-knowledge'`:
   - `pending_content` = full file text
   - `pending_summary` = bullet list:
     - Added "CSAT remark is surfaced back to Slack thread + Intercom internal note + Conversation Detail timeline" to the Slack-side CSAT section.
     - Added new section "Intercom 'assign and reply' parts" documenting the broadened part-picker (`comment` + `assignment` with body) and that dedup remains unchanged.
     - Updated the Intercom-origin notes bullet to reflect the broadened forwarding filter.
   - `pending_at` = `now()`
3. Tell you to refresh `/knowledge` and click Approve.

## Files touched

- `knowledge_documents` table only (no source file changes — the `.md` is already current).

## Out of scope

- Auto-syncing `.lovable/project-knowledge.md` ↔ DB. That would bypass the approval workflow you intentionally have.
