UPDATE knowledge_documents SET pending_content = (
  SELECT replace(
    replace(content, 
      'Searches/creates Intercom contact (handles 409 Conflict by extracting existing contact ID from error message via regex)',
      'Searches/creates Intercom contact (handles 409 Conflict by extracting existing contact ID from error message via regex). **If an email was provided via "Add Details", the contact is always updated** with the email and name via `PUT /contacts/{id}` — both when found via search and when resolved from a 409 conflict. This ensures the Intercom ticket is attributed to the correct email even if the contact was previously created without one.'
    ),
    'Last updated:** 2026-03-19',
    'Last updated:** 2026-03-20'
  )
  FROM knowledge_documents WHERE id = 'project-knowledge'
), 
pending_summary = 'Document that Intercom contacts are now updated with email/name when provided via Add Details (both on search hit and 409 conflict resolution)',
pending_at = now()
WHERE id = 'project-knowledge';