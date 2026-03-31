
-- Add status and resolved_at columns to gmail_conversations
ALTER TABLE public.gmail_conversations
  ADD COLUMN status text NOT NULL DEFAULT 'open',
  ADD COLUMN resolved_at timestamptz;

-- Create auto-close function
CREATE OR REPLACE FUNCTION public.auto_close_gmail_threads()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- Close threads where latest message is older than 24h
  UPDATE gmail_conversations
  SET status = 'resolved', resolved_at = now()
  WHERE status = 'open'
    AND gmail_thread_id IN (
      SELECT gmail_thread_id FROM gmail_conversations
      WHERE status = 'open' AND gmail_thread_id IS NOT NULL
      GROUP BY gmail_thread_id
      HAVING MAX(received_at) < now() - interval '24 hours'
    );

  -- Close orphan rows (no thread_id) older than 24h
  UPDATE gmail_conversations
  SET status = 'resolved', resolved_at = now()
  WHERE status = 'open'
    AND gmail_thread_id IS NULL
    AND received_at < now() - interval '24 hours';
END;
$$;
