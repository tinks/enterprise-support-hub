---
name: Knowledge doc updates require pending review
description: Every edit to .lovable/project-knowledge.md must also be staged as pending_content on the /knowledge page, in the same turn
type: preference
---
Whenever `.lovable/project-knowledge.md` is edited, also stage the new content as `pending_content` on `knowledge_documents` (id=`project-knowledge`) so the change shows up for review on `/knowledge`.

**How to apply:** invoke the existing `sync-knowledge-pending` edge function with `{ markdown: <full file content>, summary: <short description> }`. Do this in the same turn as the repo file edit — not a follow-up, not "the user can hit Sync later". If staging fails (401/expired session), say so explicitly in the reply and tell Matt to hit Knowledge → **Sync from app**; never end a turn silently leaving the file unstaged.

**Safety net:** the Action Center signal `doc_drift` (`src/lib/knowledgeDrift.ts`) compares the repo file against both the live and pending copies and fires when documentation was edited but never staged. Treat a firing drift card as an unfinished doc pass, not a nuisance.

**Why:** Matt's standing rule — knowledge changes must go through the UI diff/approve flow, not be silently committed. Editing only the repo file bypasses that gate, and before the drift signal existed nothing caught it.
