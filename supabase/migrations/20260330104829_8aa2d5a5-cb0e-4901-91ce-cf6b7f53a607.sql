
-- Create gmail_conversations table
CREATE TABLE public.gmail_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  gmail_message_id text UNIQUE NOT NULL,
  gmail_thread_id text,
  from_email text,
  from_name text,
  subject text,
  received_at timestamptz,
  snippet text,
  is_test boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable RLS with open policy (matches existing pattern)
ALTER TABLE public.gmail_conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all access to gmail_conversations"
  ON public.gmail_conversations
  FOR ALL
  TO public
  USING (true)
  WITH CHECK (true);

-- Add gmail_last_polled_at to settings
ALTER TABLE public.settings ADD COLUMN gmail_last_polled_at timestamptz;
