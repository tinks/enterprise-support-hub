UPDATE knowledge_documents
SET pending_content = (SELECT content FROM knowledge_documents WHERE id = 'project-knowledge'),
    pending_summary = 'Adds Gmail integration docs (§23), employee admin ID attribution map, fetch-thread-messages edge function, thread timeline, new secrets, gmail_last_polled_at. Updates date to 2026-03-30.',
    pending_at = now()
WHERE id = 'project-knowledge';