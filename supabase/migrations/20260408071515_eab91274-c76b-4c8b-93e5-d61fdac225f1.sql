-- Remove duplicates: for each intercom_conversation_id, keep the row with the smallest id
DELETE FROM manual_messages WHERE conversation_id IN (
  SELECT mc1.id FROM manual_conversations mc1
  WHERE mc1.intercom_conversation_id IS NOT NULL
    AND mc1.id != (
      SELECT mc2.id FROM manual_conversations mc2
      WHERE mc2.intercom_conversation_id = mc1.intercom_conversation_id
      ORDER BY mc2.created_at ASC, mc2.id ASC
      LIMIT 1
    )
);
DELETE FROM manual_conversations mc1
WHERE mc1.intercom_conversation_id IS NOT NULL
  AND mc1.id != (
    SELECT mc2.id FROM manual_conversations mc2
    WHERE mc2.intercom_conversation_id = mc1.intercom_conversation_id
    ORDER BY mc2.created_at ASC, mc2.id ASC
    LIMIT 1
  );

-- Add unique partial index
CREATE UNIQUE INDEX idx_manual_conversations_intercom_id
  ON manual_conversations (intercom_conversation_id)
  WHERE intercom_conversation_id IS NOT NULL;