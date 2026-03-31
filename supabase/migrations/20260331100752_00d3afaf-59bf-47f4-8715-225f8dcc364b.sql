ALTER TABLE public.gmail_conversations
  ADD COLUMN to_emails text,
  ADD COLUMN cc_emails text;