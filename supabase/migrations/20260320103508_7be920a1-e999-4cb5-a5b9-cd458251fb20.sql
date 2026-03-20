UPDATE knowledge_documents SET pending_content = (
  SELECT replace(content, 
    '### Step 6b-ii: Human agent replies from Intercom
- **Function:** `intercom-webhook`
- Removes old feedback buttons',
    '### Step 6b-ii: Human agent replies from Intercom
- **Function:** `intercom-webhook`
- **Ticket payload handling:** When a conversation has been converted to a ticket (via escalation), Intercom sends `ticket.admin.replied` webhooks with a different payload structure — the conversation ID is nested at `body.data.item.ticket.id` instead of `body.data.item.id`. The webhook extracts the ID from both paths: `item.id || item.ticket.id || item.ticket_id || item.conversation_id`.
- Removes old feedback buttons'
  )
  FROM knowledge_documents WHERE id = 'project-knowledge'
), 
pending_summary = 'Document that intercom-webhook handles ticket.admin.replied payloads where conversation ID is at body.data.item.ticket.id (fix for replies not relayed after Sam auto-escalation converts conversation to ticket)',
pending_at = now()
WHERE id = 'project-knowledge'