CREATE INDEX IF NOT EXISTS idx_manual_messages_conversation_id
  ON public.manual_messages (conversation_id);

CREATE INDEX IF NOT EXISTS idx_manual_messages_conversation_created
  ON public.manual_messages (conversation_id, created_at);

CREATE INDEX IF NOT EXISTS idx_gmail_conversations_intercom_conversation_id
  ON public.gmail_conversations (intercom_conversation_id)
  WHERE intercom_conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_manual_conversations_updated_at
  ON public.manual_conversations (updated_at DESC)
  WHERE intercom_conversation_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_intercom_sync_jobs_v3_kind_created
  ON public.intercom_sync_jobs_v3 (kind, created_at DESC);