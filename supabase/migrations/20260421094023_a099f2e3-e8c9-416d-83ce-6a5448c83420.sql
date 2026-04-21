WITH ranked AS (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY conversation_id, role, message_text, date_trunc('second', created_at)
    ORDER BY id
  ) AS rn
  FROM public.manual_messages
)
DELETE FROM public.manual_messages
WHERE id IN (SELECT id FROM ranked WHERE rn > 1);