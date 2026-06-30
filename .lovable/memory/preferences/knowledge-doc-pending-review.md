---
name: Knowledge doc updates require pending review
description: Every edit to .lovable/project-knowledge.md must also be staged as pending_content on the /knowledge page
type: preference
---
Whenever `.lovable/project-knowledge.md` is edited, also stage the new content as `pending_content` on `knowledge_documents` (id=`project-knowledge`) so the change shows up for review on `/knowledge`.

**How to apply:** invoke the existing `sync-knowledge-pending` edge function with `{ markdown: <full file content>, summary: <short description> }`. Do this in the same turn as the repo file edit — not a follow-up.

**Why:** Matt's standing rule — knowledge changes must go through the UI diff/approve flow, not be silently committed. Editing only the repo file bypasses that gate.
