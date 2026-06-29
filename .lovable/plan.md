## Catch up Knowledge page + resume standing behavior

### Part 1 — One-blob catch-up

Stage the current `.lovable/project-knowledge.md` into the `knowledge_documents` row (id `project-knowledge`) as `pending_content`, with a short `pending_summary` describing the window of drift.

- Write `pending_content` = full current contents of `.lovable/project-knowledge.md`
- Write `pending_summary` = "Catch-up: accumulated edits from 2026-06-10 through today, including Step 15 channel notification (C0BDZAY8R8A)"
- Set `pending_at = now()`
- Do NOT touch `content` — that stays as the last-approved version so the diff viewer on `/knowledge` shows old vs. new

Result: next time you load `/knowledge`, the page opens in `review` mode with the full delta. Approve once and the DB catches up.

### Part 2 — Resume standing behavior going forward

From the next turn onward, any logic change that affects knowledge will:

1. Edit `.lovable/project-knowledge.md` in the repo (source of truth, as today).
2. In the **same turn**, write the updated markdown into `knowledge_documents.pending_content` (with a one-line `pending_summary` describing the change and `pending_at = now()`).
3. Tell you in chat that there's a pending knowledge change to review on `/knowledge`.

No silent writes to `content`. No repo-only edits. Approval always goes through your UI.

### Out of scope

- No change to the `/knowledge` UI itself (diff viewer already exists).
- No backfill of per-change history — this is a single blob, as you chose.
- No change to Flow page or `changelog_entries` workflow.
