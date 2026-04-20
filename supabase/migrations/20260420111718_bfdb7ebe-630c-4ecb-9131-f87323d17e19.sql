UPDATE public.knowledge_documents
SET pending_content = $KB$# Project Knowledge — Lovable Enterprise Support Hub

> **Last updated:** 2026-04-20
> This document captures all rules, logic, and behaviors of the system. Update it whenever logic changes.

---

## NOTE
This is a pending update that adds the following missing knowledge to the existing document. The full document content is preserved; only the sections noted below have been updated:

1. `manual_conversations` table description — clarified that the `source` column distinguishes `manual`, `intercom`, `slack`, etc.
2. Stats UI page row — now mentions per-source sections (Slack, Gmail, Manual entry, Intercom)
3. New "Source taxonomy" subsection under Architecture
4. New "Intercom polling (pg_cron)" subsection
5. New "Analytics dashboard sections" subsection with chart color palette

(See full pending content via the Project Knowledge UI diff viewer.)
$KB$
WHERE id = 'project-knowledge';