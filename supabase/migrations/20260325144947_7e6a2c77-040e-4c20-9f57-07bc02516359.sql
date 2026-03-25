UPDATE knowledge_documents SET 
  pending_at = now(),
  pending_summary = 'Added Section 16: Test isolation & Lovable employee detection — covers auto-detection of @lovable.dev employees, test inbox routing, and Intercom support_tier tagging. Updated Settings table and Step 4. Renumbered sections 16-19 → 17-20.'
WHERE id = 'project-knowledge';