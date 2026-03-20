UPDATE knowledge_documents SET pending_content = (
  SELECT replace(content, 
    '- Includes "Subscribe to status updates" button linking to status page',
    '- Includes "👍 This resolved my issue", "👎 Escalate to human" (hidden if already escalated), and "📡 Subscribe to status updates" buttons in the status block'
  )
  FROM knowledge_documents WHERE id = 'project-knowledge'
), 
pending_summary = 'Document that incident.io status block now includes the escalate button (conditionally hidden if already escalated)',
pending_at = now()
WHERE id = 'project-knowledge';