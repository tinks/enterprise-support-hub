ALTER TABLE public.conversation_mappings
  ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS prompt_message_ts text;